# SFU — Voz, Vídeo e Compartilhamento de Tela

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evoluir o SFU audio-only do Yerl para suportar vídeo com simulcast (3 layers), screen sharing com áudio do sistema, e múltiplos shares simultâneos — com bugs críticos corrigidos.

**Architecture:** SFU incremental em 6 fases. Backend Go com pion/webrtc v4.2.9 encaminha pacotes RTP entre peers, com strip de extension headers para compatibilidade cross-browser. Frontend React com hooks de WebRTC, layout Voice-First que transiciona para grid/focus conforme mídia ativa. Layer selection via `ReplaceTrack` sem renegociação SDP.

**Tech Stack:** Go 1.26, pion/webrtc v4.2.9, pion/rtp, pion/rtcp, gorilla/websocket, SQLite/sqlc, React 19, TanStack Router, TanStack Query, Tailwind CSS v4, DaisyUI v5, Vitest

**Spec:** `docs/superpowers/specs/2026-03-24-sfu-voice-video-screenshare-design.md`

---

## File Structure

### Backend — Arquivos Modificados
- `internal/service/sfu/peer.go` — Peer com context, OnTrack com RID, RTCP loop
- `internal/service/sfu/room.go` — Room com TrackType, layer subscriptions, ReplaceTrack, cleanup, user limit
- `internal/transport/http/sfu_handler.go` — Novos message types, validação, auth futura
- `internal/domain/webrtc.go` — TrackType, novos tipos de mensagem, payloads
- `migrations/20260314000000_init.sql` — Colunas type/user_limit/bitrate em channels
- `cmd/server/main.go` — Wiring de novas dependências

### Backend — Arquivos Novos
- `internal/service/sfu/forwarder.go` — TrackForwarder (ctx + read loop + strip extensions)
- `internal/service/sfu/peer_test.go` — Testes unitários do Peer
- `internal/service/sfu/room_test.go` — Testes unitários do Room
- `internal/service/sfu/forwarder_test.go` — Testes do TrackForwarder
- `internal/repository/sqlite/query/channel.sql` — Queries sqlc para voice channels

### Frontend — Arquivos Modificados
- `web/src/hooks/useWebRTC.ts` — Vídeo, screen share, reconnect, layer selection
- `web/src/routes/canal.tsx` — Voice-First layout com novos componentes

### Frontend — Arquivos Novos
- `web/src/components/voice/VoiceParticipant.tsx` — Avatar + nome + mute/speaking
- `web/src/components/voice/VideoTile.tsx` — `<video>` + fallback avatar
- `web/src/components/voice/VoiceChannel.tsx` — Orquestra layouts (voice/video/share)
- `web/src/components/voice/ControlBar.tsx` — Mic/Cam/Share/Leave
- `web/src/components/voice/ScreenShareView.tsx` — Renderiza screen shares
- `web/src/hooks/useSpeakingDetection.ts` — AudioContext + AnalyserNode
- `web/src/hooks/useWebRTC.test.ts` — Testes do hook

---

## Fase 1: Correção de Bugs Críticos

### Task 1: Context no Peer — fix memory leak

**Files:**
- Modify: `internal/service/sfu/peer.go`
- Create: `internal/service/sfu/peer_test.go`

- [ ] **Step 1: Escrever teste que verifica cleanup de goroutines**

```go
// internal/service/sfu/peer_test.go
package sfu

import (
	"context"
	"runtime"
	"testing"
	"time"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPeer_Close_CancelsContext(t *testing.T) {
	room := &Room{
		ID:     "test-room",
		Peers:  make(map[string]*Peer),
		Tracks: make(map[string]trackInfo),
	}

	ctx := context.Background()
	p, err := NewPeer(ctx, "peer-1", "Test User", room, func(msg domain.SignalingMessage) error {
		return nil
	})
	require.NoError(t, err)

	// Verifica que context não está cancelado antes do Close
	assert.NoError(t, p.ctx.Err())

	p.Close()

	// Verifica que context foi cancelado após Close
	assert.Error(t, p.ctx.Err())
	assert.True(t, p.isClosed)
}

func TestPeer_Close_IsIdempotent(t *testing.T) {
	room := &Room{
		ID:     "test-room",
		Peers:  make(map[string]*Peer),
		Tracks: make(map[string]trackInfo),
	}

	ctx := context.Background()
	p, err := NewPeer(ctx, "peer-1", "Test User", room, func(msg domain.SignalingMessage) error {
		return nil
	})
	require.NoError(t, err)

	// Chamar Close duas vezes não deve dar panic
	p.Close()
	p.Close()
	assert.True(t, p.isClosed)
}
```

- [ ] **Step 2: Rodar teste e confirmar que falha**

Run: `go test -v -run TestPeer_Close ./internal/service/sfu/...`
Expected: FAIL — `NewPeer` não aceita `ctx` como parâmetro

- [ ] **Step 3: Implementar context no Peer**

Modificar `internal/service/sfu/peer.go`:

```go
// Adicionar campos ao Peer struct
type Peer struct {
	ID             string
	Name           string
	Room           *Room
	PC             *webrtc.PeerConnection
	SendSignalFunc func(msg domain.SignalingMessage) error

	ctx               context.Context
	cancel            context.CancelFunc
	mu                sync.Mutex
	isClosed          bool
	pendingCandidates []webrtc.ICECandidateInit
}

// NewPeer recebe context
func NewPeer(ctx context.Context, id, name string, room *Room, sendSignal func(domain.SignalingMessage) error) (*Peer, error) {
	peerCtx, cancel := context.WithCancel(ctx)

	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
		},
	}

	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		cancel()
		return nil, err
	}

	p := &Peer{
		ID:                id,
		Name:              name,
		Room:              room,
		PC:                pc,
		SendSignalFunc:    sendSignal,
		ctx:               peerCtx,
		cancel:            cancel,
		pendingCandidates: make([]webrtc.ICECandidateInit, 0),
	}

	p.setupHandlers()
	return p, nil
}

// Close chama cancel antes de fechar PC
func (p *Peer) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.isClosed {
		return
	}
	p.isClosed = true
	p.cancel() // Cancela context ANTES de fechar PC

	if p.Room != nil {
		p.Room.RemovePeer(p.ID)
	}

	if p.PC != nil {
		p.PC.Close()
	}
}
```

Atualizar o loop RTP no `setupHandlers` do `OnTrack`:

```go
// Dentro de OnTrack, substituir o loop for infinito por:
go func() {
	rtpBuf := make([]byte, 1400)
	for {
		select {
		case <-p.ctx.Done():
			p.Room.RemoveTrack(remoteTrack.ID(), p.ID)
			return
		default:
		}

		i, _, readErr := remoteTrack.Read(rtpBuf)
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				slog.Info("Remote track ended", "track_id", remoteTrack.ID())
			}
			p.Room.RemoveTrack(remoteTrack.ID(), p.ID)
			return
		}

		if _, err := localTrack.Write(rtpBuf[:i]); err != nil {
			if !errors.Is(err, io.ErrClosedPipe) {
				slog.Error("Error writing to local track", "err", err)
			}
		}
	}
}()
```

- [ ] **Step 4: Atualizar sfu_handler.go para passar context**

Em `internal/transport/http/sfu_handler.go`, na criação do peer:

```go
// Antes:
p, err := sfu.NewPeer(peerID, joinData.Name, room, sendSignal)
// Depois:
p, err := sfu.NewPeer(r.Context(), peerID, joinData.Name, room, sendSignal)
```

- [ ] **Step 5: Rodar testes e confirmar que passam**

Run: `go test -v -race -run TestPeer_Close ./internal/service/sfu/...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/service/sfu/peer.go internal/service/sfu/peer_test.go internal/transport/http/sfu_handler.go
git commit -m "fix: adicionar context ao Peer para evitar memory leak em goroutines RTP"
```

---

### Task 2: Corrigir erros silenciados no broadcast

**Files:**
- Modify: `internal/service/sfu/room.go`
- Create: `internal/service/sfu/room_test.go`

- [ ] **Step 1: Escrever teste para broadcastParticipants com erro de envio**

```go
// internal/service/sfu/room_test.go
package sfu

import (
	"context"
	"errors"
	"testing"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRoom_AddPeer_BroadcastsParticipants(t *testing.T) {
	room := &Room{
		ID:     "test-room",
		Peers:  make(map[string]*Peer),
		Tracks: make(map[string]trackInfo),
	}

	var received []domain.SignalingMessage

	ctx := context.Background()
	p, err := NewPeer(ctx, "peer-1", "Alice", room, func(msg domain.SignalingMessage) error {
		received = append(received, msg)
		return nil
	})
	require.NoError(t, err)
	defer p.Close()

	room.AddPeer(p)

	// Deve ter recebido mensagem de participants
	require.Len(t, received, 1)
	assert.Equal(t, "participants", received[0].Type)
}

func TestRoom_BroadcastParticipants_LogsErrorOnSendFailure(t *testing.T) {
	room := &Room{
		ID:     "test-room",
		Peers:  make(map[string]*Peer),
		Tracks: make(map[string]trackInfo),
	}

	sendErr := errors.New("connection closed")
	ctx := context.Background()
	p, err := NewPeer(ctx, "peer-1", "Alice", room, func(msg domain.SignalingMessage) error {
		return sendErr
	})
	require.NoError(t, err)
	defer p.Close()

	// Não deve dar panic mesmo com erro de envio
	room.Peers[p.ID] = p
	room.broadcastParticipants() // Antes: silenciava com _ =
}
```

- [ ] **Step 2: Rodar teste**

Run: `go test -v -run TestRoom ./internal/service/sfu/...`
Expected: PASS (mas broadcastParticipants ainda silencia erros — teste verifica que não dá panic)

- [ ] **Step 3: Corrigir erros silenciados em room.go**

```go
// internal/service/sfu/room.go — broadcastParticipants
func (r *Room) broadcastParticipants() {
	participants := make([]domain.Participant, 0, len(r.Peers))
	for id, p := range r.Peers {
		participants = append(participants, domain.Participant{
			ID:   id,
			Name: p.Name,
		})
	}

	payload, err := json.Marshal(participants)
	if err != nil {
		slog.Error("Failed to marshal participants", "err", err, "room_id", r.ID)
		return
	}

	msg := domain.SignalingMessage{
		Type:    "participants",
		Payload: payload,
	}

	for _, p := range r.Peers {
		if err := p.SendSignalFunc(msg); err != nil {
			slog.Error("Failed to send participants to peer",
				"err", err, "peer_id", p.ID, "room_id", r.ID)
		}
	}
}
```

- [ ] **Step 4: Rodar testes**

Run: `go test -v -race ./internal/service/sfu/...`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/service/sfu/room.go internal/service/sfu/room_test.go
git commit -m "fix: tratar erros silenciados no broadcast de participantes"
```

---

### Task 3: Identidade do peer — mensagem `joined`

**Files:**
- Modify: `internal/domain/webrtc.go`
- Modify: `internal/transport/http/sfu_handler.go`
- Modify: `web/src/hooks/useWebRTC.ts`
- Modify: `web/src/routes/canal.tsx`

- [ ] **Step 1: Adicionar tipo JoinedPayload no domain**

```go
// internal/domain/webrtc.go — adicionar ao final do arquivo

// JoinedPayload é enviado pelo server após o peer entrar na sala.
type JoinedPayload struct {
	PeerID string `json:"peerId"`
}
```

- [ ] **Step 2: Enviar `joined` no handler após AddPeer**

Em `internal/transport/http/sfu_handler.go`, após `room.AddPeer(p)`:

```go
// Enviar confirmação de join com peerID
joinedPayload, err := json.Marshal(domain.JoinedPayload{PeerID: peerID})
if err != nil {
	slog.Error("Failed to marshal joined payload", "err", err)
} else {
	sendSignal(domain.SignalingMessage{
		Type:    "joined",
		Payload: joinedPayload,
	})
}
```

- [ ] **Step 3: Tratar `joined` no frontend useWebRTC.ts**

Em `web/src/hooks/useWebRTC.ts`:

Adicionar state:
```typescript
const [myPeerID, setMyPeerID] = useState<string | null>(null);
```

No `ws.onmessage`, adicionar case:
```typescript
} else if (msg.type === 'joined') {
  const joined = msg.payload as { peerId: string };
  setMyPeerID(joined.peerId);
}
```

Expor no return:
```typescript
return { ..., myPeerID };
```

- [ ] **Step 4: Usar myPeerID no canal.tsx**

Em `web/src/routes/canal.tsx`, na lista de participantes:

```tsx
// Antes:
{p.id === localStorage.getItem('yerl_peer_id') ? '(Você)' : (p.name === username ? '(Você*)' : '')}

// Depois:
{p.id === myPeerID ? '(Você)' : ''}
```

Adicionar `myPeerID` no destructuring do `useWebRTC`:
```tsx
const { connect, disconnect, connected, remoteStreams, isMuted, toggleMute, stats, participants, myPeerID } = useWebRTC(name ?? '', username);
```

- [ ] **Step 5: Rodar e verificar**

Run: `go build ./... && npm --prefix web run lint`
Expected: BUILD OK, LINT OK

- [ ] **Step 6: Commit**

```bash
git add internal/domain/webrtc.go internal/transport/http/sfu_handler.go web/src/hooks/useWebRTC.ts web/src/routes/canal.tsx
git commit -m "fix: enviar peerID ao cliente via mensagem joined"
```

---

### Task 4: Validação de entrada no handler

**Files:**
- Modify: `internal/transport/http/sfu_handler.go`
- Modify: `internal/domain/webrtc.go`

- [ ] **Step 1: Adicionar tipo ErrorPayload no domain**

```go
// internal/domain/webrtc.go
type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
```

- [ ] **Step 2: Adicionar validação e envio de erro no handler**

Em `internal/transport/http/sfu_handler.go`, no case `"join"`, após parsear joinData:

```go
import "regexp"

var validRoomID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// Dentro do case "join", após parsear joinData:
if !validRoomID.MatchString(joinData.RoomID) {
	errPayload, _ := json.Marshal(domain.ErrorPayload{
		Code:    "invalid-room-id",
		Message: "RoomID deve ter 1-64 caracteres alfanuméricos, hífens ou underscores",
	})
	sendSignal(domain.SignalingMessage{Type: "error", Payload: errPayload})
	continue
}

name := strings.TrimSpace(joinData.Name)
if name == "" || len(name) > 32 {
	errPayload, _ := json.Marshal(domain.ErrorPayload{
		Code:    "invalid-name",
		Message: "Nome deve ter 1-32 caracteres",
	})
	sendSignal(domain.SignalingMessage{Type: "error", Payload: errPayload})
	continue
}
joinData.Name = name
```

Adicionar `"strings"` e `"regexp"` nos imports.

- [ ] **Step 3: Tratar `error` no frontend**

Em `web/src/hooks/useWebRTC.ts`, no `ws.onmessage`:

```typescript
} else if (msg.type === 'error') {
  const err = msg.payload as { code: string; message: string };
  console.error(`SFU error [${err.code}]: ${err.message}`);
}
```

- [ ] **Step 4: Build e lint**

Run: `go build ./... && npm --prefix web run lint`
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add internal/transport/http/sfu_handler.go internal/domain/webrtc.go web/src/hooks/useWebRTC.ts
git commit -m "fix: validar entrada de roomId e nome no handler WebSocket"
```

---

## Fase 2: Refatoração de Tracks e Protocolo

### Task 5: TrackType e novos tipos de mensagem no domain

**Files:**
- Modify: `internal/domain/webrtc.go`

- [ ] **Step 1: Adicionar tipos ao domain**

```go
// internal/domain/webrtc.go — adicionar

// TrackType classifica o tipo de media track.
type TrackType string

const (
	TrackTypeAudio       TrackType = "audio"
	TrackTypeVideo       TrackType = "video"
	TrackTypeScreenVideo TrackType = "screenshare-video"
	TrackTypeScreenAudio TrackType = "screenshare-audio"
)

// TrackAddedPayload notifica que um track foi adicionado.
type TrackAddedPayload struct {
	PeerID    string    `json:"peerId"`
	TrackType TrackType `json:"trackType"`
	RID       string    `json:"rid,omitempty"`
}

// TrackRemovedPayload notifica que um track foi removido.
type TrackRemovedPayload struct {
	PeerID    string    `json:"peerId"`
	TrackType TrackType `json:"trackType"`
}

// SelectLayerPayload solicita troca de layer de simulcast.
type SelectLayerPayload struct {
	PeerID    string    `json:"peerId"`
	TrackType TrackType `json:"trackType"`
	RID       string    `json:"rid"` // "h", "m", "l"
}

// MuteStatusPayload notifica mute/unmute de um track.
type MuteStatusPayload struct {
	PeerID    string    `json:"peerId"`
	TrackType TrackType `json:"trackType"`
	Muted     bool      `json:"muted"`
}
```

- [ ] **Step 2: Build**

Run: `go build ./...`
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add internal/domain/webrtc.go
git commit -m "feat: adicionar TrackType e payloads de signaling no domain"
```

---

### Task 6: TrackForwarder com strip de RTP extensions

**Files:**
- Create: `internal/service/sfu/forwarder.go`
- Create: `internal/service/sfu/forwarder_test.go`

- [ ] **Step 1: Escrever teste do TrackForwarder**

```go
// internal/service/sfu/forwarder_test.go
package sfu

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTrackForwarder_Stop_CancelsContext(t *testing.T) {
	ctx := context.Background()
	f := &TrackForwarder{
		RID: "h",
	}
	f.ctx, f.cancel = context.WithCancel(ctx)

	assert.NoError(t, f.ctx.Err())
	f.Stop()
	assert.Error(t, f.ctx.Err())
}

func TestClassifyTrack_Camera(t *testing.T) {
	tests := []struct {
		streamID string
		isVideo  bool
		expected TrackType
	}{
		{"peer1-camera", false, TrackTypeAudio},
		{"peer1-camera", true, TrackTypeVideo},
		{"peer1-screen-0", true, TrackTypeScreenVideo},
		{"peer1-screen-0", false, TrackTypeScreenAudio},
		{"peer1-screen-1", true, TrackTypeScreenVideo},
		{"random-stream", true, TrackTypeVideo},
		{"random-stream", false, TrackTypeAudio},
	}

	for _, tt := range tests {
		result := ClassifyTrack(tt.streamID, tt.isVideo)
		assert.Equal(t, tt.expected, result, "streamID=%s isVideo=%v", tt.streamID, tt.isVideo)
	}
}
```

- [ ] **Step 2: Rodar teste e confirmar falha**

Run: `go test -v -run TestTrackForwarder ./internal/service/sfu/...`
Expected: FAIL — `TrackForwarder` e `ClassifyTrack` não existem

- [ ] **Step 3: Implementar TrackForwarder e ClassifyTrack**

```go
// internal/service/sfu/forwarder.go
package sfu

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// TrackType aliases para uso interno
type TrackType = domain.TrackType

const (
	TrackTypeAudio       = domain.TrackTypeAudio
	TrackTypeVideo       = domain.TrackTypeVideo
	TrackTypeScreenVideo = domain.TrackTypeScreenVideo
	TrackTypeScreenAudio = domain.TrackTypeScreenAudio
)

// TrackForwarder encapsula a leitura de um track remoto e escrita no local.
type TrackForwarder struct {
	ctx    context.Context
	cancel context.CancelFunc
	Remote *webrtc.TrackRemote
	Local  *webrtc.TrackLocalStaticRTP
	RID    string
	Kind   TrackType
}

// Start inicia a goroutine de forwarding com strip de RTP extension headers.
func (f *TrackForwarder) Start() {
	go func() {
		buf := make([]byte, 1500)
		for {
			select {
			case <-f.ctx.Done():
				return
			default:
			}

			i, _, err := f.Remote.Read(buf)
			if err != nil {
				if !errors.Is(err, io.EOF) {
					slog.Error("Error reading remote track",
						"err", err, "rid", f.RID, "kind", f.Kind)
				}
				return
			}

			pkt := &rtp.Packet{}
			if err := pkt.Unmarshal(buf[:i]); err != nil {
				continue
			}

			// Strip extension headers para compatibilidade cross-browser
			pkt.Extension = false
			pkt.Extensions = nil

			if err := f.Local.WriteRTP(pkt); err != nil {
				if !errors.Is(err, io.ErrClosedPipe) {
					slog.Error("Error writing to local track",
						"err", err, "rid", f.RID, "kind", f.Kind)
				}
			}
		}
	}()
}

// Stop cancela o context e para o forwarding.
func (f *TrackForwarder) Stop() {
	if f.cancel != nil {
		f.cancel()
	}
}

// NewTrackForwarder cria um forwarder para um track remoto.
func NewTrackForwarder(ctx context.Context, remote *webrtc.TrackRemote, local *webrtc.TrackLocalStaticRTP, kind TrackType) *TrackForwarder {
	fCtx, cancel := context.WithCancel(ctx)
	return &TrackForwarder{
		ctx:    fCtx,
		cancel: cancel,
		Remote: remote,
		Local:  local,
		RID:    remote.RID(),
		Kind:   kind,
	}
}

// ClassifyTrack determina o tipo de track baseado no stream ID e codec type.
func ClassifyTrack(streamID string, isVideo bool) TrackType {
	if strings.Contains(streamID, "-screen") {
		if isVideo {
			return TrackTypeScreenVideo
		}
		return TrackTypeScreenAudio
	}
	if isVideo {
		return TrackTypeVideo
	}
	return TrackTypeAudio
}
```

- [ ] **Step 4: Rodar testes**

Run: `go test -v -race ./internal/service/sfu/...`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/service/sfu/forwarder.go internal/service/sfu/forwarder_test.go
git commit -m "feat: implementar TrackForwarder com strip de RTP extension headers"
```

---

### Task 7: Refatorar Room com TrackType, layer subscriptions e cleanup

**Files:**
- Modify: `internal/service/sfu/room.go`
- Modify: `internal/service/sfu/room_test.go`

- [ ] **Step 1: Escrever teste para Room com UserLimit**

```go
// internal/service/sfu/room_test.go — adicionar

func TestRoom_AddPeer_RespectsUserLimit(t *testing.T) {
	room := &Room{
		ID:        "test-room",
		UserLimit: 2,
		Peers:     make(map[string]*Peer),
		Tracks:    make(map[string]trackInfo),
	}

	ctx := context.Background()
	noop := func(msg domain.SignalingMessage) error { return nil }

	p1, err := NewPeer(ctx, "peer-1", "Alice", room, noop)
	require.NoError(t, err)
	defer p1.Close()

	err = room.AddPeer(p1)
	require.NoError(t, err)

	p2, err := NewPeer(ctx, "peer-2", "Bob", room, noop)
	require.NoError(t, err)
	defer p2.Close()

	err = room.AddPeer(p2)
	require.NoError(t, err)

	p3, err := NewPeer(ctx, "peer-3", "Charlie", room, noop)
	require.NoError(t, err)
	defer p3.Close()

	err = room.AddPeer(p3)
	assert.Error(t, err) // Room cheia
}

func TestRoomManager_CleansUpEmptyRooms(t *testing.T) {
	rm := NewRoomManager()
	room := rm.GetOrCreateRoom("test-room")

	ctx := context.Background()
	noop := func(msg domain.SignalingMessage) error { return nil }

	p, err := NewPeer(ctx, "peer-1", "Alice", room, noop)
	require.NoError(t, err)

	room.AddPeer(p)
	assert.Len(t, rm.rooms, 1)

	p.Close() // RemovePeer → room vazia → cleanup
	// Dar tempo para cleanup
	assert.Eventually(t, func() bool {
		rm.mu.RLock()
		defer rm.mu.RUnlock()
		return len(rm.rooms) == 0
	}, time.Second, 10*time.Millisecond)
}
```

- [ ] **Step 2: Rodar testes e confirmar falha**

Run: `go test -v -run "TestRoom_AddPeer_Respects|TestRoomManager_Cleans" ./internal/service/sfu/...`
Expected: FAIL — `AddPeer` não retorna erro, `Room` não tem `UserLimit`, sem cleanup

- [ ] **Step 3: Refatorar Room**

```go
// internal/service/sfu/room.go — mudanças principais

type Room struct {
	ID        string
	UserLimit int // 0 = sem limite
	mu        sync.RWMutex
	Peers     map[string]*Peer
	Tracks    map[string]trackInfo
	manager   *RoomManager // referência para cleanup
}

type trackInfo struct {
	track  *webrtc.TrackLocalStaticRTP
	peerID string
	kind   TrackType
	rid    string
}

// AddPeer agora retorna error
func (r *Room) AddPeer(p *Peer) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.UserLimit > 0 && len(r.Peers) >= r.UserLimit {
		return fmt.Errorf("room %s is full (%d/%d)", r.ID, len(r.Peers), r.UserLimit)
	}

	r.Peers[p.ID] = p
	slog.Info("Peer added to room", "peer_id", p.ID, "room_id", r.ID)

	r.broadcastParticipants()

	for _, info := range r.Tracks {
		if info.peerID == p.ID {
			continue
		}
		if err := p.AddTrack(info.track); err != nil {
			slog.Error("Failed to add existing track to new peer", "err", err, "peer_id", p.ID)
		}
	}

	return nil
}

// RemovePeer com cleanup de room vazia
func (r *Room) RemovePeer(peerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.Peers, peerID)

	for tid, info := range r.Tracks {
		if info.peerID == peerID {
			delete(r.Tracks, tid)
		}
	}

	slog.Info("Peer removed from room", "peer_id", peerID, "room_id", r.ID)
	r.broadcastParticipants()

	// Cleanup room vazia
	if len(r.Peers) == 0 && r.manager != nil {
		go r.manager.removeRoom(r.ID)
	}
}

// AddTrack com kind e rid
func (r *Room) AddTrack(track *webrtc.TrackLocalStaticRTP, sourcePeerID string, kind TrackType, rid string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	uniqueTrackID := fmt.Sprintf("%s-%s-%s", sourcePeerID, track.ID(), rid)
	r.Tracks[uniqueTrackID] = trackInfo{
		track:  track,
		peerID: sourcePeerID,
		kind:   kind,
		rid:    rid,
	}

	slog.Info("Track added to room",
		"track_id", uniqueTrackID, "room_id", r.ID,
		"source_peer", sourcePeerID, "kind", kind, "rid", rid)

	for pid, p := range r.Peers {
		if pid == sourcePeerID {
			continue
		}
		if err := p.AddTrack(track); err != nil {
			slog.Error("Failed to add new track to peer", "err", err, "peer_id", pid)
		}
	}
}

// RoomManager — adicionar removeRoom
func (m *RoomManager) removeRoom(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rooms, id)
	slog.Info("Empty room removed", "room_id", id)
}

// GetOrCreateRoom — setar manager ref
func (m *RoomManager) GetOrCreateRoom(id string) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()

	if r, ok := m.rooms[id]; ok {
		return r
	}

	r := &Room{
		ID:      id,
		Peers:   make(map[string]*Peer),
		Tracks:  make(map[string]trackInfo),
		manager: m,
	}
	m.rooms[id] = r
	slog.Info("Room created", "room_id", id)
	return r
}
```

- [ ] **Step 4: Atualizar peer.go e sfu_handler.go para nova assinatura de AddPeer e AddTrack**

Em `peer.go`, OnTrack handler:
```go
// Antes: p.Room.AddTrack(localTrack, p.ID)
// Depois:
kind := ClassifyTrack(remoteTrack.StreamID(), remoteTrack.Kind() == webrtc.RTPCodecTypeVideo)
p.Room.AddTrack(localTrack, p.ID, kind, remoteTrack.RID())
```

Em `sfu_handler.go`:
```go
// Antes: room.AddPeer(p)
// Depois:
if err := room.AddPeer(p); err != nil {
	slog.Error("Failed to add peer to room", "err", err)
	errPayload, _ := json.Marshal(domain.ErrorPayload{
		Code:    "room-full",
		Message: err.Error(),
	})
	sendSignal(domain.SignalingMessage{Type: "error", Payload: errPayload})
	p.Close()
	break
}
```

- [ ] **Step 5: Atualizar RemoveTrack para incluir RID**

```go
func (r *Room) RemoveTrack(trackID string, sourcePeerID string, rid string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	uniqueTrackID := fmt.Sprintf("%s-%s-%s", sourcePeerID, trackID, rid)
	delete(r.Tracks, uniqueTrackID)
	slog.Info("Track removed from room", "track_id", uniqueTrackID, "room_id", r.ID)
}
```

Atualizar chamadas em `peer.go`:
```go
// Antes: p.Room.RemoveTrack(remoteTrack.ID(), p.ID)
// Depois: p.Room.RemoveTrack(remoteTrack.ID(), p.ID, remoteTrack.RID())
```

- [ ] **Step 6: Rodar testes**

Run: `go test -v -race ./internal/service/sfu/...`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add internal/service/sfu/room.go internal/service/sfu/room_test.go internal/service/sfu/peer.go internal/transport/http/sfu_handler.go
git commit -m "feat: refatorar Room com TrackType, user limit e cleanup de rooms vazias"
```

---

### Task 8: Novos message types no handler

**Files:**
- Modify: `internal/transport/http/sfu_handler.go`

- [ ] **Step 1: Adicionar handlers para select-layer e mute-status**

Em `internal/transport/http/sfu_handler.go`, no switch:

```go
case "select-layer":
	if currentPeer == nil {
		continue
	}
	var payload domain.SelectLayerPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		slog.Error("Failed to unmarshal select-layer", "err", err)
		continue
	}
	slog.Info("Layer selection requested",
		"peer_id", peerID, "target_peer", payload.PeerID,
		"track_type", payload.TrackType, "rid", payload.RID)
	// TODO: implementar layer switching na Fase 4

case "mute-status":
	if currentPeer == nil {
		continue
	}
	var payload domain.MuteStatusPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		slog.Error("Failed to unmarshal mute-status", "err", err)
		continue
	}
	payload.PeerID = peerID // Forçar o peerID do remetente
	mutePayload, err := json.Marshal(payload)
	if err != nil {
		slog.Error("Failed to marshal mute-status", "err", err)
		continue
	}
	// Broadcast mute status para outros peers
	if currentPeer.Room != nil {
		currentPeer.Room.BroadcastExcept(peerID, domain.SignalingMessage{
			Type:    "mute-status",
			Payload: mutePayload,
		})
	}
```

- [ ] **Step 2: Adicionar BroadcastExcept no Room**

```go
// internal/service/sfu/room.go
func (r *Room) BroadcastExcept(excludePeerID string, msg domain.SignalingMessage) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for pid, p := range r.Peers {
		if pid == excludePeerID {
			continue
		}
		if err := p.SendSignalFunc(msg); err != nil {
			slog.Error("Failed to broadcast message",
				"err", err, "peer_id", pid, "type", msg.Type)
		}
	}
}
```

- [ ] **Step 3: Build**

Run: `go build ./...`
Expected: OK

- [ ] **Step 4: Commit**

```bash
git add internal/transport/http/sfu_handler.go internal/service/sfu/room.go
git commit -m "feat: adicionar handlers para select-layer e mute-status"
```

---

## Fase 3: Database + Autenticação

### Task 9: Schema de voice channels

**Files:**
- Modify: `migrations/20260314000000_init.sql`
- Create: `internal/repository/sqlite/query/channel.sql`

- [ ] **Step 1: Editar migração init**

```sql
-- migrations/20260314000000_init.sql
-- +goose Up
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    user_limit INTEGER NOT NULL DEFAULT 0,
    bitrate INTEGER NOT NULL DEFAULT 64000,
    created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

-- +goose Down
DROP TABLE messages;
DROP TABLE channels;
DROP TABLE users;
```

- [ ] **Step 2: Criar queries sqlc**

```sql
-- internal/repository/sqlite/query/channel.sql

-- name: CreateChannel :one
INSERT INTO channels (id, name, type, user_limit, bitrate, created_at)
VALUES (?, ?, ?, ?, ?, ?) RETURNING *;

-- name: GetChannelByID :one
SELECT * FROM channels WHERE id = ?;

-- name: ListChannelsByType :many
SELECT * FROM channels WHERE type = ? ORDER BY name;

-- name: ListVoiceChannels :many
SELECT * FROM channels WHERE type = 'voice' ORDER BY name;

-- name: DeleteChannel :exec
DELETE FROM channels WHERE id = ?;
```

- [ ] **Step 3: Gerar código sqlc**

Run: `make sqlc`
Expected: Geração OK, novos arquivos em `internal/repository/sqlite/sqlc/`

- [ ] **Step 4: Build**

Run: `go build ./...`
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add migrations/20260314000000_init.sql internal/repository/sqlite/query/channel.sql internal/repository/sqlite/sqlc/
git commit -m "feat: adicionar tipo voice channel no schema e queries sqlc"
```

---

### Task 10: Integrar UserLimit na criação de Room

**Files:**
- Modify: `internal/transport/http/sfu_handler.go`
- Modify: `internal/service/sfu/room.go`

- [ ] **Step 1: GetOrCreateRoom recebe UserLimit**

```go
// internal/service/sfu/room.go
func (m *RoomManager) GetOrCreateRoom(id string, userLimit int) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()

	if r, ok := m.rooms[id]; ok {
		return r
	}

	r := &Room{
		ID:        id,
		UserLimit: userLimit,
		Peers:     make(map[string]*Peer),
		Tracks:    make(map[string]trackInfo),
		manager:   m,
	}
	m.rooms[id] = r
	slog.Info("Room created", "room_id", id, "user_limit", userLimit)
	return r
}
```

- [ ] **Step 2: Handler passa UserLimit (default 15 por enquanto)**

Em `sfu_handler.go`:
```go
// Antes: room := h.roomManager.GetOrCreateRoom(joinData.RoomID)
// Depois:
room := h.roomManager.GetOrCreateRoom(joinData.RoomID, 15) // TODO: buscar do DB quando integrado
```

- [ ] **Step 3: Build e testes**

Run: `go build ./... && go test -v -race ./internal/service/sfu/...`
Expected: PASS (ajustar testes que chamam GetOrCreateRoom para passar 0)

- [ ] **Step 4: Commit**

```bash
git add internal/service/sfu/room.go internal/service/sfu/room_test.go internal/transport/http/sfu_handler.go
git commit -m "feat: integrar UserLimit na criação de rooms"
```

---

### Task 10b: Auth simplificado no WebSocket

**Files:**
- Modify: `internal/transport/http/sfu_handler.go`
- Modify: `internal/domain/account.go`
- Modify: `web/src/hooks/useWebRTC.ts`
- Modify: `web/src/routes/canal.tsx`

> **Nota:** O Login handler atual é stub (retorna 200 vazio). Esta task implementa auth básica via query param token que mapeia para userID. Auth completa (JWT/sessions) será escopo de outra feature. O objetivo aqui é eliminar o formulário de nome e usar identidade real do banco.

- [ ] **Step 1: Adicionar FindByID ao AccountRepository**

Em `internal/domain/account.go`:
```go
type AccountRepository interface {
	Create(ctx context.Context, acc *Account) error
	FindByEmail(ctx context.Context, email string) (*Account, error)
	FindByID(ctx context.Context, id string) (*Account, error)
}
```

Implementar no repository sqlite, adicionar query sqlc, rodar `make sqlc` e `make generate`.

- [ ] **Step 2: SFUHandler recebe AccountService**

```go
type SFUHandler struct {
	roomManager    *sfu.RoomManager
	accountService domain.AccountService
}

func NewSFUHandler(roomManager *sfu.RoomManager, accountService domain.AccountService) *SFUHandler {
	return &SFUHandler{
		roomManager:    roomManager,
		accountService: accountService,
	}
}
```

Atualizar `cmd/server/main.go`:
```go
sfuHandler := transporthttp.NewSFUHandler(roomManager, accountService)
```

- [ ] **Step 3: Extrair userID do query param no handler**

Em `HandleWS`, antes do loop:
```go
// Auth simplificado: userID via query param
// TODO: substituir por JWT/cookie quando auth completa for implementada
userID := r.URL.Query().Get("userId")
if userID == "" {
	http.Error(w, "userId query param required", http.StatusUnauthorized)
	return
}
// Usar userID como peerID
peerID := userID
```

No case `"join"`, buscar nome do banco:
```go
// Buscar nome do usuário do banco
// Se não encontrar, usar o nome do payload como fallback
userName := joinData.Name
// TODO: descomentar quando FindByID estiver implementado
// account, err := h.accountService.FindByID(r.Context(), peerID)
// if err == nil { userName = account.Name }
```

- [ ] **Step 4: Frontend envia userId na conexão WebSocket**

Em `web/src/hooks/useWebRTC.ts`, adicionar `userId` param:
```typescript
export function useWebRTC(roomId: string, username?: string, userId?: string) {
  // ...
  const wsUrl = `${protocol}//${window.location.host}/api/ws?userId=${encodeURIComponent(userId || username || '')}`;
```

- [ ] **Step 5: Build e testes**

Run: `go build ./... && npm --prefix web run lint`
Expected: OK

- [ ] **Step 6: Commit**

```bash
git add internal/transport/http/sfu_handler.go internal/domain/account.go cmd/server/main.go web/src/hooks/useWebRTC.ts web/src/routes/canal.tsx
git commit -m "feat: auth simplificado no WebSocket via userId query param"
```

---

## Fase 4: Vídeo com Simulcast

### Task 11: MediaEngine customizado com VP8 + Opus

**Files:**
- Modify: `internal/service/sfu/peer.go`

- [ ] **Step 1: Extrair criação de PeerConnection para usar MediaEngine**

```go
// internal/service/sfu/peer.go

// newPeerConnection cria uma PeerConnection com MediaEngine configurado.
func newPeerConnection(config webrtc.Configuration) (*webrtc.PeerConnection, error) {
	m := &webrtc.MediaEngine{}

	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeVP8,
			ClockRate:   90000,
			SDPFmtpLine: "",
		},
		PayloadType: 96,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, fmt.Errorf("register VP8: %w", err)
	}

	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:  webrtc.MimeTypeOpus,
			ClockRate: 48000,
			Channels:  2,
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, fmt.Errorf("register Opus: %w", err)
	}

	api := webrtc.NewAPI(webrtc.WithMediaEngine(m))
	return api.NewPeerConnection(config)
}
```

Substituir em `NewPeer`:
```go
// Antes: pc, err := webrtc.NewPeerConnection(config)
// Depois:
pc, err := newPeerConnection(config)
```

- [ ] **Step 2: Build e testes**

Run: `go build ./... && go test -v -race ./internal/service/sfu/...`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add internal/service/sfu/peer.go
git commit -m "feat: configurar MediaEngine com VP8 e Opus para simulcast"
```

---

### Task 12: OnTrack com RID e TrackForwarder

**Files:**
- Modify: `internal/service/sfu/peer.go`

- [ ] **Step 1: Refatorar OnTrack para usar TrackForwarder e RID**

```go
// internal/service/sfu/peer.go — setupHandlers, substituir OnTrack inteiro

p.PC.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
	rid := remoteTrack.RID()
	isVideo := remoteTrack.Kind() == webrtc.RTPCodecTypeVideo
	kind := ClassifyTrack(remoteTrack.StreamID(), isVideo)

	slog.Info("Track received",
		"kind", kind, "rid", rid,
		"track_id", remoteTrack.ID(),
		"stream_id", remoteTrack.StreamID(),
		"peer_id", p.ID)

	localTrack, err := webrtc.NewTrackLocalStaticRTP(
		remoteTrack.Codec().RTPCodecCapability,
		remoteTrack.ID(),
		remoteTrack.StreamID(),
		webrtc.WithRTPStreamID(rid),
	)
	if err != nil {
		slog.Error("Failed to create local track", "err", err)
		return
	}

	p.Room.AddTrack(localTrack, p.ID, kind, rid)

	fwd := NewTrackForwarder(p.ctx, remoteTrack, localTrack, kind)
	fwd.Start()

	// RTCP: ler feedback e enviar PLI periódico
	go func() {
		for {
			if _, _, err := receiver.ReadRTCP(); err != nil {
				return
			}
		}
	}()

	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-p.ctx.Done():
				return
			case <-ticker.C:
				if err := p.PC.WriteRTCP([]rtcp.Packet{
					&rtcp.PictureLossIndication{
						MediaSSRC: uint32(remoteTrack.SSRC()),
					},
				}); err != nil {
					if !errors.Is(err, io.ErrClosedPipe) {
						slog.Error("Failed to send PLI", "err", err)
					}
					return
				}
			}
		}
	}()
})
```

Adicionar imports: `"time"`, `"github.com/pion/rtcp"`

- [ ] **Step 2: go mod tidy e build**

Run: `go mod tidy && go build ./...`
Expected: OK — `pion/rtcp` já é indirect dependency, será promovido a direct

- [ ] **Step 3: Rodar testes**

Run: `go test -v -race ./internal/service/sfu/...`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add internal/service/sfu/peer.go go.mod go.sum
git commit -m "feat: refatorar OnTrack para simulcast com TrackForwarder e RTCP PLI"
```

---

### Task 12b: Layer selection via ReplaceTrack

**Files:**
- Modify: `internal/service/sfu/room.go`
- Modify: `internal/service/sfu/peer.go`
- Modify: `internal/transport/http/sfu_handler.go`

- [ ] **Step 1: Adicionar layerSubscription e referência ao sender no Room**

```go
// internal/service/sfu/room.go

type layerSubscription struct {
	sourcePeerID string
	trackType    TrackType
	currentRID   string
	sender       *webrtc.RTPSender
}

// Adicionar ao Room struct:
type Room struct {
	// ... existente
	subscriptions map[string][]layerSubscription // key: subscriber peerID
}
```

Inicializar `subscriptions` em `GetOrCreateRoom`.

- [ ] **Step 2: AddTrack retorna sender para manter referência**

```go
// internal/service/sfu/peer.go — AddTrack retorna *webrtc.RTPSender
func (p *Peer) AddTrack(track *webrtc.TrackLocalStaticRTP) (*webrtc.RTPSender, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.isClosed {
		return nil, errors.New("peer is closed")
	}

	sender, err := p.PC.AddTrack(track)
	return sender, err
}
```

Atualizar `Room.AddTrack` para armazenar sender na subscription:
```go
for pid, p := range r.Peers {
	if pid == sourcePeerID {
		continue
	}
	sender, err := p.AddTrack(track)
	if err != nil {
		slog.Error("Failed to add track to peer", "err", err, "peer_id", pid)
		continue
	}
	// Registrar subscription
	r.subscriptions[pid] = append(r.subscriptions[pid], layerSubscription{
		sourcePeerID: sourcePeerID,
		trackType:    kind,
		currentRID:   rid,
		sender:       sender,
	})
}
```

- [ ] **Step 3: Implementar SelectLayer no Room**

```go
// internal/service/sfu/room.go
func (r *Room) SelectLayer(subscriberPeerID string, sourcePeerID string, trackType TrackType, rid string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Encontrar a subscription
	subs, ok := r.subscriptions[subscriberPeerID]
	if !ok {
		return fmt.Errorf("no subscriptions for peer %s", subscriberPeerID)
	}

	for i, sub := range subs {
		if sub.sourcePeerID == sourcePeerID && sub.trackType == trackType {
			// Encontrar o track da layer desejada
			targetKey := fmt.Sprintf("%s-%s-%s", sourcePeerID, sub.sender.Track().ID(), rid)
			info, exists := r.Tracks[targetKey]
			if !exists {
				return fmt.Errorf("layer %s not found for track", rid)
			}

			// ReplaceTrack — sem renegociação SDP
			if err := sub.sender.ReplaceTrack(info.track); err != nil {
				return fmt.Errorf("replace track: %w", err)
			}

			subs[i].currentRID = rid
			slog.Info("Layer switched",
				"subscriber", subscriberPeerID, "source", sourcePeerID,
				"type", trackType, "rid", rid)
			return nil
		}
	}

	return fmt.Errorf("subscription not found")
}
```

- [ ] **Step 4: Conectar select-layer no handler**

Em `sfu_handler.go`, substituir o TODO:
```go
case "select-layer":
	if currentPeer == nil || currentPeer.Room == nil {
		continue
	}
	var payload domain.SelectLayerPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		slog.Error("Failed to unmarshal select-layer", "err", err)
		continue
	}
	if err := currentPeer.Room.SelectLayer(peerID, payload.PeerID, domain.TrackType(payload.TrackType), payload.RID); err != nil {
		slog.Error("Failed to select layer", "err", err, "peer_id", peerID)
	}
```

- [ ] **Step 5: Build e testes**

Run: `go build ./... && go test -v -race ./internal/service/sfu/...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/service/sfu/room.go internal/service/sfu/peer.go internal/transport/http/sfu_handler.go
git commit -m "feat: implementar layer selection via ReplaceTrack sem renegociação SDP"
```

---

### Task 13: Frontend — Vídeo no useWebRTC

**Files:**
- Modify: `web/src/hooks/useWebRTC.ts`

- [ ] **Step 1: Adicionar suporte a vídeo e simulcast encodings**

Mudanças em `web/src/hooks/useWebRTC.ts`:

Novos states:
```typescript
const [isVideoEnabled, setIsVideoEnabled] = useState(false);
const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
```

Nova função `toggleVideo`:
```typescript
const toggleVideo = useCallback(async () => {
  if (!pcRef.current || !wsRef.current) return;

  if (isVideoEnabled) {
    // Desligar câmera
    if (localVideoStream) {
      localVideoStream.getTracks().forEach(track => {
        track.stop();
        const senders = pcRef.current?.getSenders();
        const sender = senders?.find(s => s.track === track);
        if (sender) pcRef.current?.removeTrack(sender);
      });
      setLocalVideoStream(null);
    }
    setIsVideoEnabled(false);
  } else {
    // Ligar câmera
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    setLocalVideoStream(videoStream);

    const videoTrack = videoStream.getVideoTracks()[0];
    const sender = pcRef.current.addTrack(videoTrack, videoStream);

    // Configurar simulcast encodings (ordem crescente: l → m → h)
    const params = sender.getParameters();
    params.encodings = [
      { rid: 'l', maxBitrate: 100_000, scaleResolutionDownBy: 4 },
      { rid: 'm', maxBitrate: 500_000, scaleResolutionDownBy: 2 },
      { rid: 'h', maxBitrate: 2_500_000, scaleResolutionDownBy: 1 },
    ];
    await sender.setParameters(params);

    setIsVideoEnabled(true);
  }
}, [isVideoEnabled, localVideoStream]);
```

Atualizar `disconnect` para limpar vídeo:
```typescript
if (localVideoStream) {
  localVideoStream.getTracks().forEach(track => track.stop());
  setLocalVideoStream(null);
}
```

Expor no return:
```typescript
return { ..., isVideoEnabled, toggleVideo, localVideoStream };
```

- [ ] **Step 2: Lint**

Run: `npm --prefix web run lint`
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useWebRTC.ts
git commit -m "feat: adicionar suporte a video com simulcast no useWebRTC"
```

---

### Task 14: Componentes UI — VoiceParticipant, VideoTile, ControlBar

**Files:**
- Create: `web/src/components/voice/VoiceParticipant.tsx`
- Create: `web/src/components/voice/VideoTile.tsx`
- Create: `web/src/components/voice/ControlBar.tsx`

- [ ] **Step 1: Criar diretório e VoiceParticipant**

```bash
mkdir -p web/src/components/voice
```

```tsx
// web/src/components/voice/VoiceParticipant.tsx
import type { Participant } from '@/hooks/useWebRTC'

interface VoiceParticipantProps {
  participant: Participant
  isMe: boolean
  isMuted: boolean
  isSpeaking: boolean
}

export function VoiceParticipant({ participant, isMe, isMuted, isSpeaking }: VoiceParticipantProps) {
  const initial = participant.name.charAt(0).toUpperCase()
  const borderClass = isSpeaking ? 'ring-2 ring-success ring-offset-2 ring-offset-base-100' : ''

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`avatar placeholder ${borderClass}`}
      >
        <div className="bg-neutral text-neutral-content w-12 rounded-full">
          <span className="text-lg">{initial}</span>
        </div>
      </div>
      <span className="text-xs truncate max-w-[80px]">
        {participant.name}{isMe ? ' (Você)' : ''}
      </span>
      {isMuted && (
        <span className="badge badge-xs badge-error">mudo</span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Criar VideoTile**

```tsx
// web/src/components/voice/VideoTile.tsx
import { useEffect, useRef } from 'react'
import type { Participant } from '@/hooks/useWebRTC'

interface VideoTileProps {
  participant: Participant
  stream: MediaStream | null
  isMe: boolean
  isMuted: boolean
  isSpeaking: boolean
}

export function VideoTile({ participant, stream, isMe, isMuted, isSpeaking }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const initial = participant.name.charAt(0).toUpperCase()
  const borderClass = isSpeaking ? 'ring-2 ring-success' : ''

  if (!stream) {
    return (
      <div className={`bg-base-300 rounded-lg flex flex-col items-center justify-center aspect-video ${borderClass}`}>
        <div className="avatar placeholder">
          <div className="bg-neutral text-neutral-content w-16 rounded-full">
            <span className="text-2xl">{initial}</span>
          </div>
        </div>
        <span className="text-xs mt-2 opacity-70">
          {participant.name}{isMe ? ' (Você)' : ''}
        </span>
        {isMuted && <span className="badge badge-xs badge-error mt-1">mudo</span>}
      </div>
    )
  }

  return (
    <div className={`relative rounded-lg overflow-hidden aspect-video ${borderClass}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMe}
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-2 left-2 flex items-center gap-1">
        <span className="badge badge-sm bg-base-100/80">
          {participant.name}{isMe ? ' (Você)' : ''}
        </span>
        {isMuted && <span className="badge badge-xs badge-error">mudo</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Criar ControlBar**

```tsx
// web/src/components/voice/ControlBar.tsx

interface ControlBarProps {
  isMuted: boolean
  isVideoEnabled: boolean
  isScreenSharing: boolean
  onToggleMute: () => void
  onToggleVideo: () => void
  onToggleScreenShare: () => void
  onLeave: () => void
  username: string
}

export function ControlBar({
  isMuted,
  isVideoEnabled,
  isScreenSharing,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onLeave,
  username,
}: ControlBarProps) {
  const initial = username.charAt(0).toUpperCase()

  return (
    <div className="bg-base-300 p-3 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <div className="avatar placeholder">
          <div className="bg-neutral text-neutral-content w-8 rounded-full">
            <span className="text-sm">{initial}</span>
          </div>
        </div>
        <span className="text-sm font-medium truncate">{username}</span>
      </div>
      <div className="flex gap-2 justify-center">
        <button
          type="button"
          onClick={onToggleMute}
          className={`btn btn-sm btn-circle ${isMuted ? 'btn-error' : 'btn-ghost'}`}
          title={isMuted ? 'Desmutar' : 'Mutar'}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button
          type="button"
          onClick={onToggleVideo}
          className={`btn btn-sm btn-circle ${isVideoEnabled ? 'btn-ghost' : 'btn-ghost opacity-50'}`}
          title={isVideoEnabled ? 'Desligar câmera' : 'Ligar câmera'}
        >
          {isVideoEnabled ? '📷' : '📷'}
        </button>
        <button
          type="button"
          onClick={onToggleScreenShare}
          className={`btn btn-sm btn-circle ${isScreenSharing ? 'btn-info' : 'btn-ghost'}`}
          title={isScreenSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
        >
          🖥️
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="btn btn-sm btn-circle btn-error"
          title="Sair da sala"
        >
          📞
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Lint**

Run: `npm --prefix web run lint`
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add web/src/components/voice/
git commit -m "feat: criar componentes VoiceParticipant, VideoTile e ControlBar"
```

---

### Task 15: VoiceChannel layout e refatorar canal.tsx

**Files:**
- Create: `web/src/components/voice/VoiceChannel.tsx`
- Modify: `web/src/routes/canal.tsx`

- [ ] **Step 1: Criar VoiceChannel — orquestra os 3 layouts**

```tsx
// web/src/components/voice/VoiceChannel.tsx
import type { Participant } from '@/hooks/useWebRTC'
import { VoiceParticipant } from './VoiceParticipant'
import { VideoTile } from './VideoTile'

interface VoiceChannelProps {
  participants: Participant[]
  myPeerID: string | null
  remoteStreams: MediaStream[]
  localVideoStream: MediaStream | null
  hasVideo: boolean
  screenShares: MediaStream[]
  mutedPeers: Set<string>
  speakingPeers: Set<string>
}

export function VoiceChannel({
  participants,
  myPeerID,
  remoteStreams,
  localVideoStream,
  hasVideo,
  screenShares,
  mutedPeers,
  speakingPeers,
}: VoiceChannelProps) {
  const hasScreenShare = screenShares.length > 0

  // Layout 3: Screen share ativo — focus + sidebar
  if (hasScreenShare) {
    return (
      <div className="flex gap-4 h-full">
        <div className="flex-[3] flex flex-col gap-2">
          {screenShares.map((stream) => (
            <div key={stream.id} className="bg-base-300 rounded-lg overflow-hidden aspect-video">
              <video
                autoPlay
                playsInline
                ref={(el) => { if (el) el.srcObject = stream }}
                className="w-full h-full object-contain"
              />
            </div>
          ))}
        </div>
        <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
          {participants.map((p) => (
            <VoiceParticipant
              key={p.id}
              participant={p}
              isMe={p.id === myPeerID}
              isMuted={mutedPeers.has(p.id)}
              isSpeaking={speakingPeers.has(p.id)}
            />
          ))}
        </div>
      </div>
    )
  }

  // Layout 2: Vídeo ativo — grid
  if (hasVideo) {
    const cols = participants.length <= 4 ? 2 : participants.length <= 9 ? 3 : 4
    return (
      <div
        className="grid gap-2 h-full"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {participants.map((p) => {
          const isMe = p.id === myPeerID
          const stream = isMe
            ? localVideoStream
            : remoteStreams.find((s) => s.id.includes(p.id)) ?? null
          return (
            <VideoTile
              key={p.id}
              participant={p}
              stream={stream}
              isMe={isMe}
              isMuted={mutedPeers.has(p.id)}
              isSpeaking={speakingPeers.has(p.id)}
            />
          )
        })}
      </div>
    )
  }

  // Layout 1: Voice-only — avatares
  return (
    <div className="flex flex-wrap gap-6 justify-center items-center py-8">
      {participants.map((p) => (
        <VoiceParticipant
          key={p.id}
          participant={p}
          isMe={p.id === myPeerID}
          isMuted={mutedPeers.has(p.id)}
          isSpeaking={speakingPeers.has(p.id)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Refatorar canal.tsx para usar novos componentes**

A página `canal.tsx` deve usar `VoiceChannel` e `ControlBar` em vez do layout inline atual. Manter o formulário de join como está por enquanto (auth será integrada depois). Substituir toda a seção `hasJoined` do return.

- [ ] **Step 3: Lint e build**

Run: `npm --prefix web run lint`
Expected: OK

- [ ] **Step 4: Commit**

```bash
git add web/src/components/voice/VoiceChannel.tsx web/src/routes/canal.tsx
git commit -m "feat: implementar layout Voice-First com transição para grid e focus"
```

---

## Fase 5: Screen Sharing

### Task 16: Screen share no useWebRTC

**Files:**
- Modify: `web/src/hooks/useWebRTC.ts`

- [ ] **Step 1: Adicionar startScreenShare e stopScreenShare**

```typescript
const [isScreenSharing, setIsScreenSharing] = useState(false);
const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
const screenStreamRef = useRef<MediaStream | null>(null);

const startScreenShare = useCallback(async () => {
  if (!pcRef.current || !wsRef.current) return;

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: true,
    });

    // Verificar se áudio do sistema foi capturado
    if (stream.getAudioTracks().length === 0) {
      console.warn('System audio not available on this platform');
    }

    stream.getTracks().forEach((track) => {
      pcRef.current?.addTrack(track, stream);

      // Detectar quando usuário para o compartilhamento via UI do browser
      track.onended = () => {
        stopScreenShare();
      };
    });

    screenStreamRef.current = stream;
    setScreenStream(stream);
    setIsScreenSharing(true);
  } catch (err) {
    // Usuário cancelou o dialog ou erro
    console.error('Failed to start screen share', err);
  }
}, []);

const stopScreenShare = useCallback(() => {
  const stream = screenStreamRef.current;
  if (stream) {
    stream.getTracks().forEach((track) => {
      track.stop();
      const senders = pcRef.current?.getSenders();
      const sender = senders?.find((s) => s.track === track);
      if (sender) pcRef.current?.removeTrack(sender);
    });
    screenStreamRef.current = null;
    setScreenStream(null);
  }
  setIsScreenSharing(false);
}, []);

const toggleScreenShare = useCallback(async () => {
  if (isScreenSharing) {
    stopScreenShare();
  } else {
    await startScreenShare();
  }
}, [isScreenSharing, startScreenShare, stopScreenShare]);
```

Expor no return:
```typescript
return { ..., isScreenSharing, toggleScreenShare, screenStream };
```

- [ ] **Step 2: Lint**

Run: `npm --prefix web run lint`
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useWebRTC.ts
git commit -m "feat: adicionar screen sharing com audio do sistema no useWebRTC"
```

---

### Task 16b: Screen share signaling no backend

**Files:**
- Modify: `internal/domain/webrtc.go`
- Modify: `internal/service/sfu/room.go`
- Modify: `internal/transport/http/sfu_handler.go`
- Modify: `web/src/hooks/useWebRTC.ts`

- [ ] **Step 1: Adicionar tipos de screen share no domain**

```go
// internal/domain/webrtc.go

type ScreenSharePayload struct {
	PeerID  string `json:"peerId"`
	ShareID string `json:"shareId"`
}
```

- [ ] **Step 2: Detectar screen share no Room.AddTrack e broadcast**

Em `room.go`, no `AddTrack`, após adicionar aos peers:
```go
// Se for screen share, broadcast notificação
if kind == TrackTypeScreenVideo {
	sharePayload, err := json.Marshal(domain.ScreenSharePayload{
		PeerID:  sourcePeerID,
		ShareID: uniqueTrackID,
	})
	if err == nil {
		for pid, p := range r.Peers {
			if pid == sourcePeerID {
				continue
			}
			_ = p.SendSignalFunc(domain.SignalingMessage{
				Type:    "screen-share-started",
				Payload: sharePayload,
			})
		}
	}
}
```

Similar em `RemoveTrack` para `screen-share-ended`.

- [ ] **Step 3: Tratar no frontend**

Em `useWebRTC.ts`, no `ws.onmessage`:
```typescript
} else if (msg.type === 'screen-share-started') {
  const data = msg.payload as { peerId: string; shareId: string };
  console.info('Screen share started', data);
} else if (msg.type === 'screen-share-ended') {
  const data = msg.payload as { peerId: string; shareId: string };
  console.info('Screen share ended', data);
}
```

- [ ] **Step 4: Build**

Run: `go build ./... && npm --prefix web run lint`
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add internal/domain/webrtc.go internal/service/sfu/room.go internal/transport/http/sfu_handler.go web/src/hooks/useWebRTC.ts
git commit -m "feat: adicionar signaling de screen-share-started/ended"
```

---

### Task 17: ScreenShareView e integração no layout

**Files:**
- Create: `web/src/components/voice/ScreenShareView.tsx`
- Modify: `web/src/components/voice/VoiceChannel.tsx`
- Modify: `web/src/routes/canal.tsx`

- [ ] **Step 1: Criar ScreenShareView**

```tsx
// web/src/components/voice/ScreenShareView.tsx
import { useEffect, useRef } from 'react'

interface ScreenShareViewProps {
  stream: MediaStream
  onDoubleClick?: () => void
}

export function ScreenShareView({ stream, onDoubleClick }: ScreenShareViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const handleDoubleClick = () => {
    if (onDoubleClick) {
      onDoubleClick()
    } else if (videoRef.current) {
      videoRef.current.requestFullscreen().catch(() => {
        // Fullscreen não suportado ou negado
      })
    }
  }

  return (
    <div
      className="bg-base-300 rounded-lg overflow-hidden aspect-video cursor-pointer"
      onDoubleClick={handleDoubleClick}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-contain"
      />
    </div>
  )
}
```

- [ ] **Step 2: Integrar screenShares no canal.tsx**

Passar `isScreenSharing`, `toggleScreenShare`, `screenStream` do `useWebRTC` para os componentes. Wiring no `VoiceChannel` e `ControlBar`.

- [ ] **Step 3: Lint**

Run: `npm --prefix web run lint`
Expected: OK

- [ ] **Step 4: Commit**

```bash
git add web/src/components/voice/ScreenShareView.tsx web/src/components/voice/VoiceChannel.tsx web/src/routes/canal.tsx
git commit -m "feat: implementar UI de screen sharing com fullscreen"
```

---

## Fase 6: UI Polish e Reconexão

### Task 18: Reconexão automática

**Files:**
- Modify: `web/src/hooks/useWebRTC.ts`

- [ ] **Step 1: Adicionar lógica de reconnect com backoff**

No `useWebRTC.ts`, adicionar:

```typescript
const reconnectAttemptsRef = useRef(0);
const maxReconnectAttempts = 5;
const [isReconnecting, setIsReconnecting] = useState(false);

// No ws.onclose:
ws.onclose = () => {
  setConnected(false);
  isConnectingRef.current = false;

  if (reconnectAttemptsRef.current < maxReconnectAttempts) {
    setIsReconnecting(true);
    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
    reconnectAttemptsRef.current++;
    setTimeout(() => {
      void connect();
    }, delay);
  } else {
    setIsReconnecting(false);
  }
};

// No ws.onopen, resetar:
ws.onopen = () => {
  setConnected(true);
  setIsReconnecting(false);
  reconnectAttemptsRef.current = 0;
  // ... rest
};
```

ICE restart:
```typescript
pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState === 'failed') {
    pc.restartIce();
  }
};
```

Expor `isReconnecting` no return.

- [ ] **Step 2: Lint**

Run: `npm --prefix web run lint`
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useWebRTC.ts
git commit -m "feat: adicionar reconexão automática com backoff exponencial"
```

---

### Task 19: Speaking detection

**Files:**
- Create: `web/src/hooks/useSpeakingDetection.ts`

- [ ] **Step 1: Implementar hook de speaking detection**

```typescript
// web/src/hooks/useSpeakingDetection.ts
import { useEffect, useRef, useState, useCallback } from 'react'

const SPEAKING_THRESHOLD = 15 // amplitude mínima para considerar "falando"
const CHECK_INTERVAL = 100 // ms

export function useSpeakingDetection(stream: MediaStream | null) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setIsSpeaking(false)
      return
    }

    const audioContext = new AudioContext()
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    const source = audioContext.createMediaStreamSource(stream)
    source.connect(analyser)

    audioContextRef.current = audioContext
    analyserRef.current = analyser

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    intervalRef.current = setInterval(() => {
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length
      setIsSpeaking(avg > SPEAKING_THRESHOLD)
    }, CHECK_INTERVAL)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      audioContext.close()
    }
  }, [stream])

  return isSpeaking
}
```

- [ ] **Step 2: Lint**

Run: `npm --prefix web run lint`
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useSpeakingDetection.ts
git commit -m "feat: implementar detecção de speaking via AudioContext"
```

---

### Task 20: Quality indicator e stats expandidos

**Files:**
- Modify: `web/src/hooks/useWebRTC.ts`
- Modify: `web/src/components/voice/VoiceParticipant.tsx`

- [ ] **Step 1: Expandir WebRTCStats para vídeo**

Em `useWebRTC.ts`, expandir interface:

```typescript
export interface WebRTCStats {
  outbound: { bitrate: number; packetsSent: number };
  inbound: { bitrate: number; packetsLost: number; jitter: number };
  latency: number;
  video?: { width: number; height: number; fps: number; bitrate: number };
  quality: 'good' | 'fair' | 'poor';
}
```

Calcular quality baseado em RTT e packet loss:
```typescript
const quality = rtt < 100 && packetsLost < 1 ? 'good'
  : rtt < 300 && packetsLost < 5 ? 'fair'
  : 'poor';
```

- [ ] **Step 2: Adicionar indicador de qualidade no VoiceParticipant**

```tsx
// Adicionar prop quality?: 'good' | 'fair' | 'poor'
const qualityColor = {
  good: 'text-success',
  fair: 'text-warning',
  poor: 'text-error',
}

// Renderizar ao lado do nome
{quality && <span className={`text-xs ${qualityColor[quality]}`}>●</span>}
```

- [ ] **Step 3: Lint**

Run: `npm --prefix web run lint`
Expected: OK

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useWebRTC.ts web/src/components/voice/VoiceParticipant.tsx
git commit -m "feat: adicionar indicador de qualidade e stats de vídeo"
```

---

### Task 21: Adicionar .superpowers ao .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Adicionar entrada**

Adicionar ao `.gitignore`:
```
.superpowers/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: adicionar .superpowers ao gitignore"
```

---

## Verificação Final

### Task 22: Build e testes completos

- [ ] **Step 1: Backend build e testes**

Run: `go build ./... && go test -v -race ./...`
Expected: BUILD OK, PASS

- [ ] **Step 2: Frontend build e testes**

Run: `npm --prefix web run lint && npm --prefix web run build`
Expected: LINT OK, BUILD OK

- [ ] **Step 3: Teste manual end-to-end**

Run: `make dev`

Testar:
1. Abrir 3 abas → entrar na mesma sala de voz
2. Verificar áudio bidirecional
3. Ligar câmera em 2 abas → verificar grid de vídeo
4. Screen share em 1 aba → verificar layout focus+sidebar
5. Clique duplo no share → fullscreen
6. Mutar/desmutar → verificar indicador
7. Stats debug → verificar RTT, bitrate, qualidade

- [ ] **Step 4: Commit final se houver ajustes**

```bash
git add -A
git commit -m "chore: ajustes finais do SFU voice/video/screenshare"
```
