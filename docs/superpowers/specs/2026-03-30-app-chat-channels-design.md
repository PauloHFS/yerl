# Design: App principal com canais e chat em tempo real

**Data:** 2026-03-30
**Status:** Aprovado

## Objetivo

Tornar o fluxo ponta-a-ponta funcional: o usuario loga, ve canais reais, envia mensagens de texto em tempo real e acessa canais de voz. Hoje o `/app` e um skeleton hardcoded e o `message_handler` e um stub.

## Decisoes de design

| Decisao | Escolha | Motivo |
|---|---|---|
| Canais | Seed via migration (sem CRUD) | Entrega rapida, CRUD vem depois |
| Chat | WebSocket dedicado (`/api/ws/chat`) | Tempo real; ciclo de vida diferente do SFU |
| Canal de voz no /app | Redireciona para `/canal` | Reutiliza feature pronta, evita complexidade |
| Arquitetura WS | Hub + Client (read/write pumps) | Padrao canonico gorilla/websocket para broadcast |
| Estado de mensagens | Local no hook (sem Zustand) | Evita bugs de sync cache/servidor |
| ChannelService | Nao criar (handler chama repo direto) | Listagem simples nao justifica camada extra |

---

## 1. Modelo de dados e seed

### Schema (sem alteracao)

A tabela `channels` ja existe com os campos necessarios:

```sql
channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  user_limit INTEGER NOT NULL DEFAULT 0,
  bitrate INTEGER NOT NULL DEFAULT 64000,
  created_at DATETIME NOT NULL
)
```

### Seed (nova migration)

```sql
-- +goose Up
INSERT INTO channels (id, name, type, user_limit, bitrate, created_at)
VALUES
  ('ch-geral', 'geral', 'text', 0, 0, datetime('now')),
  ('ch-dev', 'dev', 'text', 0, 0, datetime('now')),
  ('ch-voz', 'Voz Geral', 'voice', 10, 64000, datetime('now'));

-- +goose Down
DELETE FROM channels WHERE id IN ('ch-geral', 'ch-dev', 'ch-voz');
```

### Domain

```go
// domain/channel.go (novo)
type Channel struct {
    ID        string
    Name      string
    Type      string // "text" ou "voice"
    UserLimit int
    Bitrate   int
    CreatedAt time.Time
}

type ChannelRepository interface {
    ListAll(ctx context.Context) ([]*Channel, error)
}
```

Adicionar `SenderName string` na struct `Message` existente.

---

## 2. Backend — Chat WebSocket

### Endpoint: `GET /api/ws/chat`

Auth via cookie JWT (extraido no handshake do WebSocket).

### Protocolo (JSON via WS)

**Cliente -> Servidor:**

```jsonc
{ "type": "subscribe", "payload": { "channelId": "ch-geral" } }
{ "type": "unsubscribe", "payload": { "channelId": "ch-geral" } }
{ "type": "send-message", "payload": { "channelId": "ch-geral", "content": "oi!" } }
{ "type": "get-history", "payload": { "channelId": "ch-geral", "limit": 50, "offset": 0 } }
```

**Servidor -> Cliente:**

```jsonc
{ "type": "new-message", "payload": { "id": "...", "channelId": "ch-geral", "senderId": "...", "senderName": "Paulo", "content": "oi!", "createdAt": "..." } }
{ "type": "history", "payload": { "channelId": "ch-geral", "messages": [...] } }
{ "type": "error", "payload": { "message": "canal nao encontrado" } }
```

### Arquitetura interna

**`chat_hub.go`** — goroutine central que gerencia:
- Registro/desregistro de clients
- Mapa de subscriptions: `channelId -> set de clients`
- Broadcast de mensagens para inscritos num canal

**`chat_client.go`** — por conexao:
- `readPump()`: le mensagens do WS, despacha para hub
- `writePump()`: envia mensagens do channel `send` pro WS
- Campos: hub, conn, userID, userName, send chan

**`chat_handler.go`** — orquestra:
- Valida JWT do cookie no handshake
- Cria ChatClient, registra no hub
- Processa tipos: subscribe, unsubscribe, send-message, get-history
- Usa `messageService.Send()` e `messageService.GetHistory()` existentes
- Valida canal: ao iniciar, carrega set de channel IDs via `channelRepo.ListAll()` e rejeita subscribe/send-message para IDs inexistentes

---

## 3. Backend — Rotas HTTP e DI

### Rotas

| Rota | Auth | Handler |
|---|---|---|
| `GET /api/channels` | JWT (AuthMiddleware) | `channelHandler.List` |
| `GET /api/ws/chat` | JWT (cookie no handshake) | `chatHandler.HandleWS` |

### Rota removida

`POST /api/messages` — substituida pelo WebSocket.

### Queries sqlc novas

```sql
-- name: ListAllChannels :many
SELECT id, name, type, user_limit, bitrate, created_at
FROM channels
ORDER BY type ASC, name ASC;

-- name: GetMessagesByChannelIDWithSender :many
SELECT m.id, m.channel_id, m.sender_id, a.name as sender_name, m.content, m.created_at
FROM messages m
JOIN accounts a ON m.sender_id = a.id
WHERE m.channel_id = ?
ORDER BY m.created_at DESC
LIMIT ? OFFSET ?;
```

### DI no main.go

```go
channelRepo := sqlite.NewChannelRepository(db)
channelHandler := transporthttp.NewChannelHandler(channelRepo)

chatHub := transporthttp.NewChatHub()
go chatHub.Run()
chatHandler := transporthttp.NewChatHandler(messageService, channelRepo, chatHub)

router := transporthttp.NewRouter(accountHandler, channelHandler, chatHandler, sfuHandler)
```

`MessageHandler` removido da assinatura do `NewRouter`.

---

## 4. Frontend

### Layout do /app

```
+---------------------------+----------------------------+
|  Sidebar (w-64)           |  Area principal            |
|                           |                            |
|  YERL                     |  Header: # geral           |
|                           |                            |
|  CANAIS DE TEXTO          |  +----------------------+  |
|    # geral  <- ativo      |  | Paulo: oi!           |  |
|    # dev                  |  | Joao: e ai           |  |
|                           |  +----------------------+  |
|  CANAIS DE VOZ            |                            |
|    Voz Geral ->           |  +----------------------+  |
|                           |  | [  Mensagem...     ] |  |
|  ----------------------   |  +----------------------+  |
|  Usuario (rodape)         |                            |
+---------------------------+----------------------------+
```

### Hooks novos

**`useChannels.ts`** — TanStack Query para `GET /api/channels`. Separa textChannels e voiceChannels.

**`useChatSocket.ts`** — WebSocket para `/api/ws/chat`. Expoe:
- `subscribe(channelId)`, `unsubscribe(channelId)`
- `sendMessage(channelId, content)`
- `messages: Map<string, Message[]>` (estado local)
- Pede historico automaticamente ao fazer subscribe

### Componentes novos

```
web/src/components/chat/
  ChannelSidebar.tsx  — lista canais texto/voz, user info no rodape
  ChatArea.tsx        — header do canal + MessageList + MessageInput
  MessageList.tsx     — lista de mensagens com scroll to bottom
  MessageInput.tsx    — campo de texto + envio (Enter ou botao)
  MessageBubble.tsx   — uma mensagem (nome, conteudo, timestamp)
```

### Fluxo

1. Login -> `/app`
2. `/app` monta -> `useChannels` busca canais + `useChatSocket` conecta WS
3. Primeiro canal de texto selecionado automaticamente
4. `subscribe("ch-geral")` -> servidor envia `history` -> mensagens renderizadas
5. Usuario digita -> `send-message` via WS -> servidor persiste + broadcast
6. Trocar canal -> `unsubscribe` anterior + `subscribe` novo
7. Click em canal de voz -> `navigate('/canal?name=ch-voz')`

---

## 5. Testes

### Backend

**`chat_hub_test.go`**
- Client registra e aparece no mapa
- Client desregistra e e removido
- Subscribe/unsubscribe em canal funciona
- Broadcast entrega mensagem apenas para inscritos no canal
- Client desconectado e limpo automaticamente

**`chat_handler_test.go`**
- Conexao WS sem cookie JWT retorna 401
- `send-message` com canal inexistente retorna erro
- `send-message` valido persiste via messageService (mockado)
- `get-history` retorna mensagens do service

**`channel_handler_test.go`**
- `GET /api/channels` sem auth retorna 401
- `GET /api/channels` com auth retorna lista JSON

### Frontend

**`useChatSocket.test.ts`**
- Conecta e reconecta ao WS
- Subscribe envia mensagem correta pro server
- Recebe new-message e atualiza estado
- Recebe history e popula mensagens do canal

**`ChatArea.test.tsx`**
- Renderiza mensagens
- Scroll to bottom ao receber nova mensagem
- Input envia mensagem ao pressionar Enter

**`ChannelSidebar.test.tsx`**
- Renderiza canais texto e voz separados
- Click em canal de texto chama callback
- Click em canal de voz navega pra /canal

**`MessageInput.test.tsx`**
- Envia ao pressionar Enter
- Nao envia mensagem vazia
- Limpa input apos envio

### Fora do escopo

- Testes de integracao WS ponta-a-ponta
- Testes de repository (queries sqlc geradas, confiamos no sqlc)
