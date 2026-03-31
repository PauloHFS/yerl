# SFU — Voz, Video e Compartilhamento de Tela

**Data**: 2026-03-24
**Branch**: feat/sfu
**Status**: Aprovado

## Contexto

O Yerl (Discord self-hosted) tem um SFU básico funcional para áudio. Esta spec define a evolução para suportar vídeo com simulcast (3 layers), compartilhamento de tela com áudio do sistema, e múltiplos shares simultâneos — tudo integrado com autenticação e persistência no banco.

## Decisões

| Aspecto | Decisão |
|---|---|
| Estratégia | Incremental por capability (6 fases) |
| Capacidade | Até 15 participantes por sala |
| DB | Coluna `type` na tabela `channels` existente (editar migração init) |
| Vídeo | Simulcast completo — 3 layers (high/medium/low) |
| Screen share | Múltiplos simultâneos + áudio do sistema |
| Auth | Integrar com auth existente (JWT/session) |
| Layout | Voice-First → Focus+Sidebar quando tem vídeo/share |
| Controles | Discord style no rodapé do sidebar |

## Fase 1: Correção de Bugs Críticos

### 1.1 Memory leak no loop RTP

**Arquivo**: `internal/service/sfu/peer.go:96-116`

**Problema**: Goroutine de leitura `remoteTrack.Read()` bloqueia para sempre se o peer fechar sem o track terminar com EOF.

**Solução**: Adicionar `context.Context` ao Peer. `NewPeer` recebe `ctx` com cancel. `Peer.Close()` chama `cancel()`. O `PC.Close()` faz o `Read()` retornar erro, mas o context garante cleanup adicional.

```go
type Peer struct {
    // ... existente
    ctx    context.Context
    cancel context.CancelFunc
}
```

### 1.2 Erros silenciados no broadcast

**Arquivo**: `internal/service/sfu/room.go:104, 111`

**Problema**: `json.Marshal` e `SendSignalFunc` ignoram erros com `_`.

**Solução**: Log com `slog.Error`. Para `SendSignalFunc`, se falhar marca peer como degradado.

### 1.3 Identidade do peer

**Arquivo**: `web/src/routes/canal.tsx:109`

**Problema**: Frontend tenta `localStorage.getItem('yerl_peer_id')` mas nunca seta.

**Solução**: Novo tipo de mensagem `joined` do server com `{ peerID, roomID }`. Frontend armazena e usa para identificar "Você".

### 1.4 Validação de entrada

**Arquivo**: `internal/transport/http/sfu_handler.go`

**Solução**: Validar RoomID (não vazio, max 64 chars, alfanumérico + hífens) e Name (não vazio, max 32 chars). Retornar erro via WebSocket.

## Fase 2: Refatoração de Tracks e Protocolo

### 2.1 Modelo de tracks por tipo

```go
// domain/webrtc.go
type TrackType string
const (
    TrackTypeAudio       TrackType = "audio"
    TrackTypeVideo       TrackType = "video"
    TrackTypeScreenVideo TrackType = "screenshare-video"
    TrackTypeScreenAudio TrackType = "screenshare-audio"
)
```

`trackInfo` na Room inclui tipo e RID:

```go
type trackInfo struct {
    track    *webrtc.TrackLocalStaticRTP
    peerID   string
    kind     TrackType
    rid      string // "h", "m", "l" ou "" (áudio)
}
```

### 2.2 Simulcast no OnTrack handler

No pion/webrtc v4, `OnTrack` é chamado **uma vez por layer de simulcast** — cada invocação já recebe o `TrackRemote` correspondente a um único RID. Usar diretamente `remoteTrack` e `remoteTrack.RID()`:

```go
p.PC.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
    rid := remoteTrack.RID() // "h", "m", "l" ou "" (sem simulcast)
    trackType := classifyTrack(remoteTrack.StreamID(), remoteTrack.Kind())

    localTrack, err := webrtc.NewTrackLocalStaticRTP(
        remoteTrack.Codec().RTPCodecCapability,
        remoteTrack.ID(),
        remoteTrack.StreamID(),
        webrtc.WithRTPStreamID(rid),
    )
    if err != nil { ... }

    room.AddTrack(localTrack, peerID, trackType, rid)
    go readRTPLoop(ctx, remoteTrack, localTrack) // com strip de extensions
})
```

### 2.3 Strip de RTP extension headers no forwarding

Ao encaminhar pacotes RTP entre peers, extension headers devem ser removidas. Browsers diferentes usam IDs de extensão diferentes — sem limpeza, vídeo quebra cross-browser.

```go
func readRTPLoop(ctx context.Context, remote *webrtc.TrackRemote, local *webrtc.TrackLocalStaticRTP) {
    buf := make([]byte, 1500)
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        i, _, err := remote.Read(buf)
        if err != nil { return }

        rtpPkt := &rtp.Packet{}
        if err = rtpPkt.Unmarshal(buf[:i]); err != nil { continue }
        rtpPkt.Extension = false
        rtpPkt.Extensions = nil
        if err = local.WriteRTP(rtpPkt); err != nil && !errors.Is(err, io.ErrClosedPipe) {
            slog.Error("write rtp", "err", err)
        }
    }
}
```

Room armazena as 3 layers mas encaminha apenas 1 por peer baseado em `select-layer`.

### 2.4 Novos tipos de mensagem

| Mensagem | Direção | Payload |
|---|---|---|
| `joined` | server→client | `{ peerID }` |
| `track-added` | server→client | `{ peerID, trackType, rid }` |
| `track-removed` | server→client | `{ peerID, trackType }` |
| `select-layer` | client→server | `{ peerID, trackType, rid }` |
| `mute-status` | client→server→broadcast | `{ peerID, trackType, muted }` |
| `error` | server→client | `{ code, message }` |

### 2.5 Layer selection via ReplaceTrack

Room mantém subscriptions por peer e referência ao `RTPSender`:

```go
type layerSubscription struct {
    sourcePeerID string
    trackType    TrackType
    preferredRID string
    sender       *webrtc.RTPSender // referência para ReplaceTrack
}

// Room
subscriptions map[string][]layerSubscription // key: subscriber peerID
```

Quando `select-layer` chega, o SFU usa `sender.ReplaceTrack(newLayerTrack)` para trocar a layer **sem renegociação SDP**. Isso é crucial para 15 participantes — evita cascatas de offer/answer.

## Fase 3: Database + Autenticação

### 3.1 Editar migração existente

**Arquivo**: `migrations/20260314000000_init.sql`

> **Exceção**: O CLAUDE.md diz "nunca modificar migrations existentes", mas como estamos em dev (pré-produção, migração nunca foi aplicada em prod), editamos direto a init conforme decisão do desenvolvedor.

Adicionar na tabela `channels`:

```sql
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',       -- 'text' ou 'voice'
    user_limit INTEGER NOT NULL DEFAULT 0,   -- 0 = sem limite
    bitrate INTEGER NOT NULL DEFAULT 64000,  -- 64kbps padrão
    created_at DATETIME NOT NULL
);
```

### 3.2 Queries sqlc

Novas queries em `repository/sqlite/query/channels.sql`:
- `ListVoiceChannels` — filtra por type = 'voice'
- `CreateVoiceChannel` — insere com type = 'voice'

Rodar `make sqlc`.

### 3.3 Enforcement do limite de participantes

`Room.AddPeer` deve verificar `len(r.Peers) >= limit` e retornar erro. O handler comunica via mensagem `error` com código `room-full`.

### 3.4 Auth no WebSocket

Handler extrai token/session do cookie ou header `Authorization` no HTTP request de upgrade. Usa `userID` como `peerID`, `user.Name` do banco. Formulário de nome no frontend eliminado.

### 3.5 Cleanup de rooms vazias

`Room.RemovePeer`: se `len(r.Peers) == 0` após remoção, notifica `RoomManager` para deletar a room do mapa. Evita acúmulo de rooms órfãs.

## Fase 4: Vídeo com Simulcast

### 4.1 MediaEngine customizado

Registrar codecs manualmente (VP8 para vídeo, Opus para áudio). Extension headers de simulcast são tratadas no forwarding loop (seção 2.3), não na configuração do MediaEngine.

```go
m := &webrtc.MediaEngine{}
m.RegisterCodec(webrtc.RTPCodecParameters{
    RTPCodecCapability: webrtc.RTPCodecCapability{
        MimeType: webrtc.MimeTypeVP8, ClockRate: 90000,
    },
    PayloadType: 96,
}, webrtc.RTPCodecTypeVideo)
m.RegisterCodec(webrtc.RTPCodecParameters{
    RTPCodecCapability: webrtc.RTPCodecCapability{
        MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2,
    },
    PayloadType: 111,
}, webrtc.RTPCodecTypeAudio)
api := webrtc.NewAPI(webrtc.WithMediaEngine(m))
pc, err := api.NewPeerConnection(config)
```

### 4.1.1 RTCP feedback loop

Para simulcast funcionar bem, o SFU deve ler e reencaminhar RTCP (REMB/PLI/FIR). Goroutine dedicada por receiver lê RTCP e envia PLI periódicos quando necessário:

```go
go func() {
    for {
        _, _, err := receiver.ReadRTCP()
        if err != nil { return }
    }
}()
// PLI periódico para keyframes
go func() {
    ticker := time.NewTicker(3 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-ticker.C:
            pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(remoteTrack.SSRC())}})
        }
    }
}()
```

### 4.2 TrackForwarder

```go
type TrackForwarder struct {
    ctx    context.Context
    cancel context.CancelFunc
    remote *webrtc.TrackRemote
    local  *webrtc.TrackLocalStaticRTP
    rid    string
}
```

Room mantém `peerID → trackType → [3]TrackForwarder`.

### 4.3 Frontend — getUserMedia + simulcast

```typescript
const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: { width: { ideal: 1280 }, height: { ideal: 720 } }
});

const sender = pc.addTrack(videoTrack, stream);
const params = sender.getParameters();
// Ordem DEVE ser crescente (low → high) conforme spec WebRTC
params.encodings = [
    { rid: 'l', maxBitrate: 100_000, scaleResolutionDownBy: 4 },
    { rid: 'm', maxBitrate: 500_000, scaleResolutionDownBy: 2 },
    { rid: 'h', maxBitrate: 2_500_000, scaleResolutionDownBy: 1 },
];
sender.setParameters(params);
```

### 4.4 UI Voice-First

3 estados de layout:
1. **Voice-only**: Avatares circulares + indicador speaking
2. **Com vídeo**: Grid de vídeo, sem câmera = avatar
3. **Com screen share**: Tela 75% + sidebar 25%

Componentes: `VoiceParticipant`, `VideoTile`, `VoiceChannel`, `ControlBar`.

## Fase 5: Screen Sharing

### 5.1 getDisplayMedia

```typescript
const screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always' },
    audio: true,
});
```

Tracks de screen share são **separados** da câmera. Um peer pode ter até 4 tracks: audio câmera, vídeo câmera, vídeo tela, áudio tela.

**Nota**: Áudio do sistema via `getDisplayMedia` é **best-effort**. macOS não suporta nativamente em nenhum browser. Windows funciona em Chrome/Edge. Linux depende do compositor. O frontend deve verificar `screenStream.getAudioTracks().length` e informar o usuário se áudio do sistema não está disponível.

### 5.2 Classificação de tracks

Convenção de stream ID:
- Câmera: `"{peerID}-camera"`
- Screen: `"{peerID}-screen-{index}"`

Backend classifica:
```go
func classifyTrack(streamID string, kind webrtc.RTPCodecType) TrackType
```

### 5.3 Signaling de screen share

- `screen-share-started` → server→broadcast: `{ peerID, shareID }`
- `screen-share-ended` → server→broadcast: `{ peerID, shareID }`

Frontend detecta `track.onended` e notifica server.

### 5.4 Layout com múltiplos shares

- 1 share: 75% tela + 25% sidebar
- 2+ shares: Tabs ou mini-grid na área principal
- Clique duplo: fullscreen

## Fase 6: UI Polish e Reconexão

### 6.1 Reconexão automática

WebSocket: backoff exponencial (1s → 2s → 4s → 8s → max 30s). Máximo 5 tentativas, depois botão manual.

ICE restart: `pc.restartIce()` quando `iceConnectionState === 'failed'`.

### 6.2 Indicador de speaking

`AudioContext` + `AnalyserNode` para detectar amplitude. Borda verde pulsando no avatar.

### 6.3 Indicadores de qualidade

- Verde: RTT < 100ms, packet loss < 1%
- Amarelo: RTT < 300ms, packet loss < 5%
- Vermelho: acima

### 6.4 Controles Discord-style

Rodapé do sidebar: Avatar + nome + botões Mic/Cam/Share/Desconectar.

### 6.5 Stats expandidos

Coletar stats de vídeo (resolução, fps, bitrate por layer). Painel debug por-participante.

## Arquivos Críticos

### Backend
- `internal/service/sfu/peer.go` — Peer + TrackForwarder
- `internal/service/sfu/room.go` — Room + layer selection
- `internal/transport/http/sfu_handler.go` — WebSocket + auth
- `internal/domain/webrtc.go` — tipos de mensagem + TrackType
- `migrations/20260314000000_init.sql` — schema channels
- `repository/sqlite/query/channels.sql` — queries sqlc

### Frontend
- `web/src/hooks/useWebRTC.ts` — hook principal (vídeo, screen share, reconnect)
- `web/src/routes/canal.tsx` — refatorar para Voice-First layout
- `web/src/components/VoiceParticipant.tsx` — novo
- `web/src/components/VideoTile.tsx` — novo
- `web/src/components/VoiceChannel.tsx` — novo
- `web/src/components/ControlBar.tsx` — novo

## Verificação

### Testes por fase
1. **Fase 1**: Conectar 2 peers, desconectar 1, verificar que goroutines fecham (go test -race)
2. **Fase 2**: Enviar áudio com track types, verificar classificação correta
3. **Fase 3**: Criar voice channel via API, conectar ao WS com token válido/inválido
4. **Fase 4**: 2 peers com vídeo, verificar simulcast (3 layers no stats), trocar layer
5. **Fase 5**: Screen share entre 2 peers, verificar áudio do sistema, múltiplos shares
6. **Fase 6**: Derrubar WebSocket, verificar reconnect automático

### Testes manuais end-to-end
- `make dev` → abrir 3 abas → entrar na mesma sala
- Ligar/desligar câmera → verificar transição voice→video
- Screen share + câmera ao mesmo tempo
- Medir latência e qualidade com stats debug
