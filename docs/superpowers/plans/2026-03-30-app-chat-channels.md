# App Chat & Channels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a functional app page where logged-in users see real channels, exchange text messages in real-time via WebSocket, and join voice channels.

**Architecture:** New `GET /api/channels` REST endpoint for channel listing. New `GET /api/ws/chat` WebSocket with Hub+Client pattern (gorilla/websocket canonical broadcast). Frontend React components consume both via TanStack Query and a custom WebSocket hook.

**Tech Stack:** Go 1.22+, gorilla/websocket, sqlc, goose, React 19, TypeScript strict, TanStack Router/Query, Tailwind CSS v4, DaisyUI v5, Vitest

---

## File Map

### Create

| File | Responsibility |
|---|---|
| `migrations/20260330000000_seed_channels.sql` | Seed 3 default channels |
| `internal/domain/channel.go` | Channel struct + ChannelRepository interface |
| `internal/repository/sqlite/channel_repo.go` | ChannelRepository implementation (sqlc) |
| `internal/transport/http/channel_handler.go` | REST handler for GET /api/channels |
| `internal/transport/http/channel_handler_test.go` | Tests for channel handler |
| `internal/transport/http/chat_hub.go` | WebSocket hub: manages clients + channel subscriptions + broadcast |
| `internal/transport/http/chat_hub_test.go` | Tests for chat hub |
| `internal/transport/http/chat_client.go` | WebSocket client: readPump + writePump per connection |
| `internal/transport/http/chat_handler.go` | WebSocket handler: JWT auth, message dispatch |
| `internal/transport/http/chat_handler_test.go` | Tests for chat handler |
| `web/src/hooks/useChannels.ts` | TanStack Query hook for GET /api/channels |
| `web/src/hooks/useChatSocket.ts` | WebSocket hook for /api/ws/chat |
| `web/src/components/chat/ChannelSidebar.tsx` | Channel list sidebar component |
| `web/src/components/chat/ChannelSidebar.test.tsx` | Tests for sidebar |
| `web/src/components/chat/ChatArea.tsx` | Chat area: header + messages + input |
| `web/src/components/chat/ChatArea.test.tsx` | Tests for chat area |
| `web/src/components/chat/MessageList.tsx` | Scrollable message list |
| `web/src/components/chat/MessageInput.tsx` | Text input with Enter-to-send |
| `web/src/components/chat/MessageInput.test.tsx` | Tests for message input |
| `web/src/components/chat/MessageBubble.tsx` | Single message display |

### Modify

| File | What changes |
|---|---|
| `internal/repository/sqlite/query/channels.sql` | Add `ListAllChannels` query |
| `internal/repository/sqlite/query/message.sql` | Add `GetMessagesByChannelIDWithSender` query (JOIN accounts) |
| `internal/domain/message.go` | Add `SenderName string` to Message struct |
| `internal/repository/sqlite/message_repo.go` | New method `GetByChannelIDWithSender` using the JOIN query |
| `internal/service/message_service.go` | Update `GetHistory` to use `GetByChannelIDWithSender` |
| `internal/transport/http/router.go` | Replace MessageHandler with ChannelHandler + ChatHandler, add routes, exclude `/api/ws/chat` from LoggingMiddleware |
| `cmd/server/main.go` | Wire ChannelRepo, ChannelHandler, ChatHub, ChatHandler; remove MessageHandler |
| `web/src/routes/app.tsx` | Rewrite with ChannelSidebar + ChatArea |

---

## Task 0: Branch Setup

**Files:** none (git operations only)

- [ ] **Step 1: Pull latest main and create feature branch**

```bash
git checkout main
git pull origin main
git checkout -b feat/app-chat
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: `On branch feat/app-chat`, clean working tree (untracked files like .superpowers/ and CLAUDE.md are OK).

---

## Task 1: Seed Migration

**Files:**
- Create: `migrations/20260330000000_seed_channels.sql`

- [ ] **Step 1: Create seed migration**

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

- [ ] **Step 2: Verify migration loads**

```bash
go test -run TestNothing ./... 2>&1 | head -5
```

Expected: compiles without errors (migration file is just SQL, goose reads it at runtime).

- [ ] **Step 3: Commit**

```bash
git add migrations/20260330000000_seed_channels.sql
git commit -m "feat(db): seed de canais iniciais (geral, dev, voz)"
```

---

## Task 2: Domain Layer — Channel + Message Update

**Files:**
- Create: `internal/domain/channel.go`
- Modify: `internal/domain/message.go`

- [ ] **Step 1: Create channel domain**

```go
package domain

import (
	"context"
	"time"
)

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

- [ ] **Step 2: Add SenderName to Message struct**

In `internal/domain/message.go`, add `SenderName` field to the `Message` struct:

```go
type Message struct {
	ID         string
	ChannelID  string
	SenderID   string
	SenderName string
	Content    string
	CreatedAt  time.Time
}
```

- [ ] **Step 3: Verify compilation**

```bash
go build ./...
```

Expected: compiles (SenderName is a new field, existing code that creates Message without it will still compile since Go allows partial struct literals with named fields).

- [ ] **Step 4: Commit**

```bash
git add internal/domain/channel.go internal/domain/message.go
git commit -m "feat(domain): adicionar Channel e SenderName em Message"
```

---

## Task 3: SQL Queries + sqlc Generation

**Files:**
- Modify: `internal/repository/sqlite/query/channels.sql`
- Modify: `internal/repository/sqlite/query/message.sql`
- Generated: `internal/repository/sqlite/sqlc/` (via `make sqlc`)

- [ ] **Step 1: Add ListAllChannels query**

Append to `internal/repository/sqlite/query/channels.sql`:

```sql
-- name: ListAllChannels :many
SELECT id, name, type, user_limit, bitrate, created_at
FROM channels
ORDER BY type ASC, name ASC;
```

- [ ] **Step 2: Add GetMessagesByChannelIDWithSender query**

Append to `internal/repository/sqlite/query/message.sql`:

```sql
-- name: GetMessagesByChannelIDWithSender :many
SELECT m.id, m.channel_id, m.sender_id, a.name as sender_name, m.content, m.created_at
FROM messages m
JOIN accounts a ON m.sender_id = a.id
WHERE m.channel_id = ?
ORDER BY m.created_at DESC
LIMIT ? OFFSET ?;
```

- [ ] **Step 3: Run sqlc generate**

```bash
make sqlc
```

Expected: generates updated files in `internal/repository/sqlite/sqlc/`. Verify `channels.sql.go` has `ListAllChannels` function and `message.sql.go` has `GetMessagesByChannelIDWithSender`.

- [ ] **Step 4: Verify compilation**

```bash
go build ./...
```

- [ ] **Step 5: Commit**

```bash
git add internal/repository/sqlite/query/ internal/repository/sqlite/sqlc/
git commit -m "feat(sqlc): queries ListAllChannels e GetMessagesByChannelIDWithSender"
```

---

## Task 4: Channel Repository

**Files:**
- Create: `internal/repository/sqlite/channel_repo.go`

- [ ] **Step 1: Implement ChannelRepository**

```go
package sqlite

import (
	"context"
	"database/sql"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/PauloHFS/yerl/internal/repository/sqlite/sqlc"
)

type channelRepository struct {
	queries *sqlc.Queries
}

func NewChannelRepository(db *sql.DB) domain.ChannelRepository {
	return &channelRepository{
		queries: sqlc.New(db),
	}
}

func (r *channelRepository) ListAll(ctx context.Context) ([]*domain.Channel, error) {
	rows, err := r.queries.ListAllChannels(ctx)
	if err != nil {
		return nil, err
	}

	channels := make([]*domain.Channel, 0, len(rows))
	for _, row := range rows {
		channels = append(channels, &domain.Channel{
			ID:        row.ID,
			Name:      row.Name,
			Type:      row.Type,
			UserLimit: int(row.UserLimit),
			Bitrate:   int(row.Bitrate),
			CreatedAt: row.CreatedAt,
		})
	}

	return channels, nil
}
```

- [ ] **Step 2: Verify compilation**

```bash
go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add internal/repository/sqlite/channel_repo.go
git commit -m "feat(repo): implementar ChannelRepository com ListAll"
```

---

## Task 5: Update Message Repository for SenderName

**Files:**
- Modify: `internal/repository/sqlite/message_repo.go`
- Modify: `internal/service/message_service.go`

- [ ] **Step 1: Add GetByChannelIDWithSender to MessageRepository interface**

In `internal/domain/message.go`, add the new method to the interface:

```go
type MessageRepository interface {
	Create(ctx context.Context, msg *Message) error
	GetByChannelID(ctx context.Context, channelID string, limit, offset int) ([]*Message, error)
	GetByChannelIDWithSender(ctx context.Context, channelID string, limit, offset int) ([]*Message, error)
}
```

- [ ] **Step 2: Implement GetByChannelIDWithSender in message_repo.go**

Add this method to `internal/repository/sqlite/message_repo.go`:

```go
func (r *messageRepository) GetByChannelIDWithSender(ctx context.Context, channelID string, limit, offset int) ([]*domain.Message, error) {
	rows, err := r.queries.GetMessagesByChannelIDWithSender(ctx, sqlc.GetMessagesByChannelIDWithSenderParams{
		ChannelID: channelID,
		Limit:     int64(limit),
		Offset:    int64(offset),
	})
	if err != nil {
		return nil, err
	}

	messages := make([]*domain.Message, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, &domain.Message{
			ID:         row.ID,
			ChannelID:  row.ChannelID,
			SenderID:   row.SenderID,
			SenderName: row.SenderName,
			Content:    row.Content,
			CreatedAt:  row.CreatedAt,
		})
	}

	return messages, nil
}
```

- [ ] **Step 3: Update MessageService.GetHistory to use the new method**

In `internal/service/message_service.go`, change `GetHistory`:

```go
func (s *messageService) GetHistory(ctx context.Context, channelID string, limit, offset int) ([]*domain.Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repo.GetByChannelIDWithSender(ctx, channelID, limit, offset)
}
```

- [ ] **Step 4: Regenerate mocks**

```bash
make generate
```

- [ ] **Step 5: Verify compilation and existing tests pass**

```bash
go build ./...
go test ./internal/service/...
```

- [ ] **Step 6: Commit**

```bash
git add internal/domain/message.go internal/repository/sqlite/message_repo.go internal/service/message_service.go internal/mock/
git commit -m "feat(repo): adicionar GetByChannelIDWithSender com JOIN accounts"
```

---

## Task 6: Channel Handler + Test

**Files:**
- Create: `internal/transport/http/channel_handler.go`
- Create: `internal/transport/http/channel_handler_test.go`

- [ ] **Step 1: Write the failing test**

```go
package http_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/PauloHFS/yerl/internal/domain"
	transporthttp "github.com/PauloHFS/yerl/internal/transport/http"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubChannelRepo struct {
	channels []*domain.Channel
	err      error
}

func (s *stubChannelRepo) ListAll(ctx context.Context) ([]*domain.Channel, error) {
	return s.channels, s.err
}

func TestChannelHandler_List(t *testing.T) {
	repo := &stubChannelRepo{
		channels: []*domain.Channel{
			{ID: "ch-dev", Name: "dev", Type: "text", CreatedAt: time.Now()},
			{ID: "ch-voz", Name: "Voz Geral", Type: "voice", UserLimit: 10, Bitrate: 64000, CreatedAt: time.Now()},
		},
	}

	handler := transporthttp.NewChannelHandler(repo)
	req := httptest.NewRequest(http.MethodGet, "/api/channels", nil)
	rec := httptest.NewRecorder()

	handler.List(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)

	var channels []domain.Channel
	err := json.NewDecoder(rec.Body).Decode(&channels)
	require.NoError(t, err)
	assert.Len(t, channels, 2)
	assert.Equal(t, "ch-dev", channels[0].ID)
	assert.Equal(t, "ch-voz", channels[1].ID)
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test -v -run TestChannelHandler_List ./internal/transport/http/...
```

Expected: FAIL — `NewChannelHandler` not defined.

- [ ] **Step 3: Implement ChannelHandler**

```go
package http

import (
	"encoding/json"
	"net/http"

	"github.com/PauloHFS/yerl/internal/domain"
)

type ChannelHandler struct {
	repo domain.ChannelRepository
}

func NewChannelHandler(repo domain.ChannelRepository) *ChannelHandler {
	return &ChannelHandler{repo: repo}
}

func (h *ChannelHandler) List(w http.ResponseWriter, r *http.Request) {
	channels, err := h.repo.ListAll(r.Context())
	if err != nil {
		http.Error(w, "erro ao listar canais", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(channels); err != nil {
		http.Error(w, "erro ao serializar canais", http.StatusInternalServerError)
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
go test -v -run TestChannelHandler_List ./internal/transport/http/...
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/transport/http/channel_handler.go internal/transport/http/channel_handler_test.go
git commit -m "feat(handler): GET /api/channels com teste"
```

---

## Task 7: Chat Hub + Tests

**Files:**
- Create: `internal/transport/http/chat_hub.go`
- Create: `internal/transport/http/chat_hub_test.go`

- [ ] **Step 1: Write the failing tests**

```go
package http_test

import (
	"testing"
	"time"

	transporthttp "github.com/PauloHFS/yerl/internal/transport/http"
	"github.com/stretchr/testify/assert"
)

func TestChatHub_RegisterAndUnregister(t *testing.T) {
	hub := transporthttp.NewChatHub()
	go hub.Run()
	defer hub.Stop()

	client := &transporthttp.ChatClient{
		Send: make(chan []byte, 256),
	}

	hub.Register <- client
	time.Sleep(10 * time.Millisecond)
	assert.True(t, hub.HasClient(client))

	hub.Unregister <- client
	time.Sleep(10 * time.Millisecond)
	assert.False(t, hub.HasClient(client))
}

func TestChatHub_SubscribeAndBroadcast(t *testing.T) {
	hub := transporthttp.NewChatHub()
	go hub.Run()
	defer hub.Stop()

	client1 := &transporthttp.ChatClient{Send: make(chan []byte, 256)}
	client2 := &transporthttp.ChatClient{Send: make(chan []byte, 256)}
	client3 := &transporthttp.ChatClient{Send: make(chan []byte, 256)}

	hub.Register <- client1
	hub.Register <- client2
	hub.Register <- client3
	time.Sleep(10 * time.Millisecond)

	hub.Subscribe <- transporthttp.Subscription{Client: client1, ChannelID: "ch-geral"}
	hub.Subscribe <- transporthttp.Subscription{Client: client2, ChannelID: "ch-geral"}
	// client3 not subscribed to ch-geral
	time.Sleep(10 * time.Millisecond)

	hub.Broadcast <- transporthttp.BroadcastMessage{ChannelID: "ch-geral", Data: []byte(`{"type":"new-message"}`)}
	time.Sleep(10 * time.Millisecond)

	assert.Len(t, client1.Send, 1)
	assert.Len(t, client2.Send, 1)
	assert.Len(t, client3.Send, 0) // not subscribed
}

func TestChatHub_Unsubscribe(t *testing.T) {
	hub := transporthttp.NewChatHub()
	go hub.Run()
	defer hub.Stop()

	client := &transporthttp.ChatClient{Send: make(chan []byte, 256)}
	hub.Register <- client
	hub.Subscribe <- transporthttp.Subscription{Client: client, ChannelID: "ch-geral"}
	time.Sleep(10 * time.Millisecond)

	hub.Unsubscribe <- transporthttp.Subscription{Client: client, ChannelID: "ch-geral"}
	time.Sleep(10 * time.Millisecond)

	hub.Broadcast <- transporthttp.BroadcastMessage{ChannelID: "ch-geral", Data: []byte(`{"msg":"test"}`)}
	time.Sleep(10 * time.Millisecond)

	assert.Len(t, client.Send, 0)
}

func TestChatHub_UnregisterCleansUpSubscriptions(t *testing.T) {
	hub := transporthttp.NewChatHub()
	go hub.Run()
	defer hub.Stop()

	client := &transporthttp.ChatClient{Send: make(chan []byte, 256)}
	hub.Register <- client
	hub.Subscribe <- transporthttp.Subscription{Client: client, ChannelID: "ch-geral"}
	hub.Subscribe <- transporthttp.Subscription{Client: client, ChannelID: "ch-dev"}
	time.Sleep(10 * time.Millisecond)

	hub.Unregister <- client
	time.Sleep(10 * time.Millisecond)

	// Broadcast should not panic or send to closed channel
	hub.Broadcast <- transporthttp.BroadcastMessage{ChannelID: "ch-geral", Data: []byte(`{"msg":"test"}`)}
	time.Sleep(10 * time.Millisecond)
	// No assertion needed — if it doesn't panic, it passes
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test -v -run TestChatHub ./internal/transport/http/...
```

Expected: FAIL — types not defined.

- [ ] **Step 3: Implement ChatHub**

```go
package http

type Subscription struct {
	Client    *ChatClient
	ChannelID string
}

type BroadcastMessage struct {
	ChannelID string
	Data      []byte
}

type ChatHub struct {
	clients    map[*ChatClient]bool
	channels   map[string]map[*ChatClient]bool
	Register   chan *ChatClient
	Unregister chan *ChatClient
	Subscribe  chan Subscription
	Unsubscribe chan Subscription
	Broadcast  chan BroadcastMessage
	stop       chan struct{}
}

func NewChatHub() *ChatHub {
	return &ChatHub{
		clients:     make(map[*ChatClient]bool),
		channels:    make(map[string]map[*ChatClient]bool),
		Register:    make(chan *ChatClient),
		Unregister:  make(chan *ChatClient),
		Subscribe:   make(chan Subscription),
		Unsubscribe: make(chan Subscription),
		Broadcast:   make(chan BroadcastMessage),
		stop:        make(chan struct{}),
	}
}

func (h *ChatHub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.clients[client] = true

		case client := <-h.Unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.Send)
				for channelID, subscribers := range h.channels {
					delete(subscribers, client)
					if len(subscribers) == 0 {
						delete(h.channels, channelID)
					}
				}
			}

		case sub := <-h.Subscribe:
			if h.channels[sub.ChannelID] == nil {
				h.channels[sub.ChannelID] = make(map[*ChatClient]bool)
			}
			h.channels[sub.ChannelID][sub.Client] = true

		case sub := <-h.Unsubscribe:
			if subscribers, ok := h.channels[sub.ChannelID]; ok {
				delete(subscribers, sub.Client)
				if len(subscribers) == 0 {
					delete(h.channels, sub.ChannelID)
				}
			}

		case msg := <-h.Broadcast:
			if subscribers, ok := h.channels[msg.ChannelID]; ok {
				for client := range subscribers {
					select {
					case client.Send <- msg.Data:
					default:
						// Client buffer full — disconnect
						delete(h.clients, client)
						close(client.Send)
						for chID, subs := range h.channels {
							delete(subs, client)
							if len(subs) == 0 {
								delete(h.channels, chID)
							}
						}
					}
				}
			}

		case <-h.stop:
			return
		}
	}
}

func (h *ChatHub) Stop() {
	close(h.stop)
}

func (h *ChatHub) HasClient(c *ChatClient) bool {
	// For testing only — not goroutine safe outside of tests with sleep
	_, ok := h.clients[c]
	return ok
}
```

- [ ] **Step 4: Create minimal ChatClient struct** (needed for hub tests to compile)

Create `internal/transport/http/chat_client.go`:

```go
package http

import (
	"github.com/gorilla/websocket"
)

type ChatClient struct {
	Hub      *ChatHub
	Conn     *websocket.Conn
	UserID   string
	UserName string
	Send     chan []byte
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
go test -v -run TestChatHub ./internal/transport/http/...
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/transport/http/chat_hub.go internal/transport/http/chat_hub_test.go internal/transport/http/chat_client.go
git commit -m "feat(chat): ChatHub com register/subscribe/broadcast e testes"
```

---

## Task 8: Chat Client — Read/Write Pumps

**Files:**
- Modify: `internal/transport/http/chat_client.go`

- [ ] **Step 1: Implement readPump and writePump**

Replace `internal/transport/http/chat_client.go` with full implementation:

```go
package http

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096
)

type ChatClient struct {
	Hub      *ChatHub
	Conn     *websocket.Conn
	UserID   string
	UserName string
	Send     chan []byte
	handler  func(client *ChatClient, msg ChatMessage)
}

type ChatMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type ChatResponse struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

func (c *ChatClient) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	if err := c.Conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		return
	}
	c.Conn.SetPongHandler(func(string) error {
		return c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, data, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				slog.Error("chat ws read error", "user_id", c.UserID, "err", err)
			}
			break
		}

		var msg ChatMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Warn("chat ws invalid json", "user_id", c.UserID, "err", err)
			continue
		}

		if c.handler != nil {
			c.handler(c, msg)
		}
	}
}

func (c *ChatClient) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			if err := c.Conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				return
			}
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			if err := c.Conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				return
			}
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *ChatClient) SendJSON(resp ChatResponse) {
	data, err := json.Marshal(resp)
	if err != nil {
		slog.Error("chat marshal error", "user_id", c.UserID, "err", err)
		return
	}
	select {
	case c.Send <- data:
	default:
		slog.Warn("chat client send buffer full", "user_id", c.UserID)
	}
}
```

- [ ] **Step 2: Verify compilation**

```bash
go build ./...
```

- [ ] **Step 3: Verify existing hub tests still pass**

```bash
go test -v -run TestChatHub ./internal/transport/http/...
```

- [ ] **Step 4: Commit**

```bash
git add internal/transport/http/chat_client.go
git commit -m "feat(chat): ChatClient com readPump, writePump e ping/pong"
```

---

## Task 9: Chat Handler + Tests

**Files:**
- Create: `internal/transport/http/chat_handler.go`
- Create: `internal/transport/http/chat_handler_test.go`

- [ ] **Step 1: Write the failing tests**

```go
package http_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PauloHFS/yerl/internal/domain"
	transporthttp "github.com/PauloHFS/yerl/internal/transport/http"
	"github.com/PauloHFS/yerl/internal/service"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubMessageService struct {
	sentMessages []*domain.Message
	history      []*domain.Message
}

func (s *stubMessageService) Send(ctx context.Context, channelID, senderID, content string) (*domain.Message, error) {
	msg := &domain.Message{
		ID: "msg-1", ChannelID: channelID, SenderID: senderID, Content: content, CreatedAt: time.Now(),
	}
	s.sentMessages = append(s.sentMessages, msg)
	return msg, nil
}

func (s *stubMessageService) GetHistory(ctx context.Context, channelID string, limit, offset int) ([]*domain.Message, error) {
	return s.history, nil
}

func setupChatServer(t *testing.T) (*httptest.Server, *stubMessageService) {
	t.Helper()

	hub := transporthttp.NewChatHub()
	go hub.Run()
	t.Cleanup(hub.Stop)

	channelRepo := &stubChannelRepo{
		channels: []*domain.Channel{
			{ID: "ch-geral", Name: "geral", Type: "text"},
		},
	}

	msgService := &stubMessageService{
		history: []*domain.Message{
			{ID: "msg-old", ChannelID: "ch-geral", SenderID: "user-1", SenderName: "Paulo", Content: "oi", CreatedAt: time.Now()},
		},
	}

	handler := transporthttp.NewChatHandler(msgService, channelRepo, hub)

	// Generate a valid JWT token for testing
	token, err := service.GenerateTestToken("user-1")
	require.NoError(t, err)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.AddCookie(&http.Cookie{Name: "token", Value: token})
		handler.HandleWS(w, r)
	}))
	t.Cleanup(server.Close)

	return server, msgService
}

func wsConnect(t *testing.T, server *httptest.Server) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	return conn
}

func TestChatHandler_SubscribeAndReceiveHistory(t *testing.T) {
	server, _ := setupChatServer(t)
	conn := wsConnect(t, server)

	// Subscribe
	msg := transporthttp.ChatMessage{
		Type:    "subscribe",
		Payload: json.RawMessage(`{"channelId":"ch-geral"}`),
	}
	require.NoError(t, conn.WriteJSON(msg))

	// Should receive history response
	var resp transporthttp.ChatResponse
	require.NoError(t, conn.ReadJSON(&resp))
	assert.Equal(t, "history", resp.Type)
}

func TestChatHandler_SendMessageBroadcasts(t *testing.T) {
	server, msgService := setupChatServer(t)

	conn1 := wsConnect(t, server)
	conn2 := wsConnect(t, server)

	// Both subscribe to ch-geral
	sub := transporthttp.ChatMessage{
		Type:    "subscribe",
		Payload: json.RawMessage(`{"channelId":"ch-geral"}`),
	}
	require.NoError(t, conn1.WriteJSON(sub))
	require.NoError(t, conn2.WriteJSON(sub))

	// Drain history from both
	var discard transporthttp.ChatResponse
	require.NoError(t, conn1.ReadJSON(&discard))
	require.NoError(t, conn2.ReadJSON(&discard))

	// conn1 sends a message
	sendMsg := transporthttp.ChatMessage{
		Type:    "send-message",
		Payload: json.RawMessage(`{"channelId":"ch-geral","content":"hello!"}`),
	}
	require.NoError(t, conn1.WriteJSON(sendMsg))

	// Both should receive new-message
	var resp1, resp2 transporthttp.ChatResponse
	conn1.SetReadDeadline(time.Now().Add(2 * time.Second))
	conn2.SetReadDeadline(time.Now().Add(2 * time.Second))
	require.NoError(t, conn1.ReadJSON(&resp1))
	require.NoError(t, conn2.ReadJSON(&resp2))

	assert.Equal(t, "new-message", resp1.Type)
	assert.Equal(t, "new-message", resp2.Type)
	assert.Len(t, msgService.sentMessages, 1)
	assert.Equal(t, "hello!", msgService.sentMessages[0].Content)
}
```

Note: This test requires exposing `GenerateTestToken` from the service package. We'll create a test helper.

- [ ] **Step 2: Create test helper for JWT token generation**

Create a test-only export in `internal/service/account_service.go` — actually better to create a small test helper file. Add to `internal/service/test_helpers.go`:

```go
package service

// GenerateTestToken creates a JWT token for testing purposes.
func GenerateTestToken(userID string) (string, error) {
	return generateToken(userID)
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
go test -v -run TestChatHandler ./internal/transport/http/...
```

Expected: FAIL — `NewChatHandler` not defined.

- [ ] **Step 4: Implement ChatHandler**

```go
package http

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/PauloHFS/yerl/internal/service"
	"github.com/gorilla/websocket"
)

type ChatHandler struct {
	messageService domain.MessageService
	channelRepo    domain.ChannelRepository
	hub            *ChatHub
	validChannels  map[string]bool
}

func NewChatHandler(
	messageService domain.MessageService,
	channelRepo domain.ChannelRepository,
	hub *ChatHub,
) *ChatHandler {
	return &ChatHandler{
		messageService: messageService,
		channelRepo:    channelRepo,
		hub:            hub,
		validChannels:  make(map[string]bool),
	}
}

func (h *ChatHandler) loadChannels() {
	channels, err := h.channelRepo.ListAll(nil)
	if err != nil {
		slog.Error("chat: erro ao carregar canais", "err", err)
		return
	}
	valid := make(map[string]bool, len(channels))
	for _, ch := range channels {
		valid[ch.ID] = true
	}
	h.validChannels = valid
}

var chatUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (h *ChatHandler) HandleWS(w http.ResponseWriter, r *http.Request) {
	// Auth via cookie JWT
	cookie, err := r.Cookie("token")
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	userID, err := service.ValidateToken(cookie.Value)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	// Load channels on first connection (lazy init)
	if len(h.validChannels) == 0 {
		h.loadChannels()
	}

	conn, err := chatUpgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("chat ws upgrade error", "err", err)
		return
	}

	// Resolve user name from token — for now use userID as name
	// In a future iteration, we could look up the account name
	userName := r.URL.Query().Get("name")
	if userName == "" {
		userName = userID
	}

	client := &ChatClient{
		Hub:      h.hub,
		Conn:     conn,
		UserID:   userID,
		UserName: userName,
		Send:     make(chan []byte, 256),
		handler:  h.handleMessage,
	}

	h.hub.Register <- client

	go client.WritePump()
	go client.ReadPump()
}

type subscribePayload struct {
	ChannelID string `json:"channelId"`
}

type sendMessagePayload struct {
	ChannelID string `json:"channelId"`
	Content   string `json:"content"`
}

type getHistoryPayload struct {
	ChannelID string `json:"channelId"`
	Limit     int    `json:"limit"`
	Offset    int    `json:"offset"`
}

type newMessagePayload struct {
	ID         string `json:"id"`
	ChannelID  string `json:"channelId"`
	SenderID   string `json:"senderId"`
	SenderName string `json:"senderName"`
	Content    string `json:"content"`
	CreatedAt  string `json:"createdAt"`
}

type historyPayload struct {
	ChannelID string              `json:"channelId"`
	Messages  []newMessagePayload `json:"messages"`
}

type errorPayload struct {
	Message string `json:"message"`
}

func (h *ChatHandler) handleMessage(client *ChatClient, msg ChatMessage) {
	switch msg.Type {
	case "subscribe":
		var payload subscribePayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "payload invalido"}})
			return
		}
		if !h.validChannels[payload.ChannelID] {
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "canal nao encontrado"}})
			return
		}
		h.hub.Subscribe <- Subscription{Client: client, ChannelID: payload.ChannelID}
		h.sendHistory(client, payload.ChannelID, 50, 0)

	case "unsubscribe":
		var payload subscribePayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			return
		}
		h.hub.Unsubscribe <- Subscription{Client: client, ChannelID: payload.ChannelID}

	case "send-message":
		var payload sendMessagePayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "payload invalido"}})
			return
		}
		if !h.validChannels[payload.ChannelID] {
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "canal nao encontrado"}})
			return
		}
		if payload.Content == "" {
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "conteudo vazio"}})
			return
		}

		savedMsg, err := h.messageService.Send(context.Background(), payload.ChannelID, client.UserID, payload.Content)
		if err != nil {
			slog.Error("chat: erro ao enviar mensagem", "err", err)
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "erro ao enviar mensagem"}})
			return
		}

		broadcast := ChatResponse{
			Type: "new-message",
			Payload: newMessagePayload{
				ID:         savedMsg.ID,
				ChannelID:  savedMsg.ChannelID,
				SenderID:   savedMsg.SenderID,
				SenderName: client.UserName,
				Content:    savedMsg.Content,
				CreatedAt:  savedMsg.CreatedAt.Format("2006-01-02T15:04:05Z"),
			},
		}
		data, _ := json.Marshal(broadcast)
		h.hub.Broadcast <- BroadcastMessage{ChannelID: payload.ChannelID, Data: data}

	case "get-history":
		var payload getHistoryPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			return
		}
		h.sendHistory(client, payload.ChannelID, payload.Limit, payload.Offset)
	}
}

func (h *ChatHandler) sendHistory(client *ChatClient, channelID string, limit, offset int) {
	if limit <= 0 {
		limit = 50
	}
	messages, err := h.messageService.GetHistory(context.Background(), channelID, limit, offset)
	if err != nil {
		slog.Error("chat: erro ao buscar historico", "err", err)
		return
	}

	payload := historyPayload{
		ChannelID: channelID,
		Messages:  make([]newMessagePayload, 0, len(messages)),
	}
	for _, m := range messages {
		payload.Messages = append(payload.Messages, newMessagePayload{
			ID:         m.ID,
			ChannelID:  m.ChannelID,
			SenderID:   m.SenderID,
			SenderName: m.SenderName,
			Content:    m.Content,
			CreatedAt:  m.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	client.SendJSON(ChatResponse{Type: "history", Payload: payload})
}
```

- [ ] **Step 5: Run tests**

```bash
go test -v -run TestChatHandler ./internal/transport/http/...
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/transport/http/chat_handler.go internal/transport/http/chat_handler_test.go internal/service/test_helpers.go
git commit -m "feat(chat): ChatHandler com subscribe, send-message, get-history e testes"
```

---

## Task 10: Router + DI Wiring

**Files:**
- Modify: `internal/transport/http/router.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Update router.go**

Replace the `NewRouter` function signature and body. Remove `messageHandler` parameter, add `channelHandler` and `chatHandler`:

```go
func NewRouter(
	accountHandler *AccountHandler,
	channelHandler *ChannelHandler,
	chatHandler *ChatHandler,
	sfuHandler *SFUHandler,
) http.Handler {
	mux := http.NewServeMux()

	// Account routes
	mux.HandleFunc("POST /api/accounts/register", accountHandler.Register)
	mux.HandleFunc("POST /api/accounts/login", accountHandler.Login)

	// Channel routes
	mux.Handle("GET /api/channels", AuthMiddleware(http.HandlerFunc(channelHandler.List)))

	// Chat WebSocket
	mux.HandleFunc("GET /api/ws/chat", chatHandler.HandleWS)

	// WebRTC SFU Signaling
	mux.HandleFunc("GET /api/ws", sfuHandler.HandleWS)

	// Scalar API Reference
	mux.HandleFunc("GET /api/docs", func(w http.ResponseWriter, r *http.Request) {
		html := `<!doctype html>
<html>
  <head>
    <title>Yerl API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/api/swagger.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	})

	// Serve OpenAPI Spec
	mux.Handle("GET /api/swagger.json", http.StripPrefix("/api/", http.FileServer(http.Dir("./docs"))))

	// Servir o Frontend no fallback das rotas
	serveSPA(mux)

	// Exclude WebSocket paths from LoggingMiddleware
	return CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/ws" || r.URL.Path == "/api/ws/chat" {
			mux.ServeHTTP(w, r)
			return
		}
		LoggingMiddleware(mux).ServeHTTP(w, r)
	}))
}
```

- [ ] **Step 2: Update main.go**

Replace the DI section (lines 65-76) with:

```go
	accountRepo := sqlite.NewAccountRepository(db)
	accountService := service.NewAccountService(accountRepo)
	accountHandler := transporthttp.NewAccountHandler(accountService)

	messageRepo := sqlite.NewMessageRepository(db)
	messageService := service.NewMessageService(messageRepo)

	channelRepo := sqlite.NewChannelRepository(db)
	channelHandler := transporthttp.NewChannelHandler(channelRepo)

	chatHub := transporthttp.NewChatHub()
	go chatHub.Run()
	chatHandler := transporthttp.NewChatHandler(messageService, channelRepo, chatHub)

	roomManager := sfu.NewRoomManager()
	sfuHandler := transporthttp.NewSFUHandler(roomManager)

	router := transporthttp.NewRouter(accountHandler, channelHandler, chatHandler, sfuHandler)
```

- [ ] **Step 3: Delete message_handler.go**

```bash
rm internal/transport/http/message_handler.go
```

- [ ] **Step 4: Verify compilation**

```bash
go build ./...
```

- [ ] **Step 5: Run all Go tests**

```bash
go test ./...
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(router): integrar ChannelHandler e ChatHandler, remover MessageHandler"
```

---

## Task 11: Frontend — useChannels Hook

**Files:**
- Create: `web/src/hooks/useChannels.ts`

- [ ] **Step 1: Implement useChannels**

```typescript
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/utils/api'

export interface Channel {
  ID: string
  Name: string
  Type: 'text' | 'voice'
  UserLimit: number
  Bitrate: number
  CreatedAt: string
}

export function useChannels() {
  const query = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiClient<Channel[]>('/channels'),
  })

  const textChannels = query.data?.filter((c) => c.Type === 'text') ?? []
  const voiceChannels = query.data?.filter((c) => c.Type === 'voice') ?? []

  return {
    ...query,
    textChannels,
    voiceChannels,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useChannels.ts
git commit -m "feat(frontend): hook useChannels com TanStack Query"
```

---

## Task 12: Frontend — useChatSocket Hook

**Files:**
- Create: `web/src/hooks/useChatSocket.ts`

- [ ] **Step 1: Implement useChatSocket**

```typescript
import { useState, useEffect, useRef, useCallback } from 'react'

export interface ChatMessage {
  id: string
  channelId: string
  senderId: string
  senderName: string
  content: string
  createdAt: string
}

interface WsMessage {
  type: string
  payload: unknown
}

interface HistoryPayload {
  channelId: string
  messages: ChatMessage[]
}

export function useChatSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map())
  const subscribedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/chat`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      // Re-subscribe to channels that were subscribed before reconnect
      for (const channelId of subscribedRef.current) {
        ws.send(JSON.stringify({ type: 'subscribe', payload: { channelId } }))
      }
    }

    ws.onclose = () => {
      setConnected(false)
    }

    ws.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string) as WsMessage

      if (data.type === 'new-message') {
        const msg = data.payload as ChatMessage
        setMessages((prev) => {
          const next = new Map(prev)
          const existing = next.get(msg.channelId) ?? []
          next.set(msg.channelId, [...existing, msg])
          return next
        })
      }

      if (data.type === 'history') {
        const payload = data.payload as HistoryPayload
        setMessages((prev) => {
          const next = new Map(prev)
          // History comes DESC from server, reverse to show oldest first
          next.set(payload.channelId, [...payload.messages].reverse())
          return next
        })
      }
    }

    return () => {
      ws.close()
    }
  }, [])

  const subscribe = useCallback((channelId: string) => {
    subscribedRef.current.add(channelId)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', payload: { channelId } }))
    }
  }, [])

  const unsubscribe = useCallback((channelId: string) => {
    subscribedRef.current.delete(channelId)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', payload: { channelId } }))
    }
  }, [])

  const sendMessage = useCallback((channelId: string, content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'send-message',
        payload: { channelId, content },
      }))
    }
  }, [])

  const getMessages = useCallback((channelId: string): ChatMessage[] => {
    return messages.get(channelId) ?? []
  }, [messages])

  return {
    connected,
    subscribe,
    unsubscribe,
    sendMessage,
    getMessages,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useChatSocket.ts
git commit -m "feat(frontend): hook useChatSocket para WebSocket do chat"
```

---

## Task 13: Frontend — MessageInput + Test

**Files:**
- Create: `web/src/components/chat/MessageInput.tsx`
- Create: `web/src/components/chat/MessageInput.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageInput } from './MessageInput'

describe('MessageInput', () => {
  it('envia mensagem ao pressionar Enter', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} />)

    const input = screen.getByPlaceholderText(/mensagem/i)
    await userEvent.type(input, 'oi pessoal{enter}')

    expect(onSend).toHaveBeenCalledWith('oi pessoal')
  })

  it('nao envia mensagem vazia', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} />)

    const input = screen.getByPlaceholderText(/mensagem/i)
    await userEvent.type(input, '{enter}')

    expect(onSend).not.toHaveBeenCalled()
  })

  it('limpa input apos envio', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} />)

    const input = screen.getByPlaceholderText(/mensagem/i)
    await userEvent.type(input, 'hello{enter}')

    expect(input).toHaveValue('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx --prefix web vitest run src/components/chat/MessageInput.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement MessageInput**

```tsx
import { useState } from 'react'

interface MessageInputProps {
  onSend: (content: string) => void
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [value, setValue] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onSend(trimmed)
    setValue('')
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-base-300">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enviar mensagem..."
        className="input input-bordered w-full"
      />
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx --prefix web vitest run src/components/chat/MessageInput.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/chat/MessageInput.tsx web/src/components/chat/MessageInput.test.tsx
git commit -m "feat(frontend): componente MessageInput com testes"
```

---

## Task 14: Frontend — MessageBubble + MessageList

**Files:**
- Create: `web/src/components/chat/MessageBubble.tsx`
- Create: `web/src/components/chat/MessageList.tsx`

- [ ] **Step 1: Implement MessageBubble**

```tsx
import type { ChatMessage } from '@/hooks/useChatSocket'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const time = new Date(message.createdAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="flex gap-3 px-4 py-1 hover:bg-base-200">
      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-1">
        {message.senderName.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">{message.senderName}</span>
          <span className="text-xs opacity-50">{time}</span>
        </div>
        <p className="text-sm break-words">{message.content}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement MessageList**

```tsx
import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@/hooks/useChatSocket'
import { MessageBubble } from './MessageBubble'

interface MessageListProps {
  messages: ChatMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-base-content/50">
        <p>Nenhuma mensagem ainda. Seja o primeiro!</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto py-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/chat/MessageBubble.tsx web/src/components/chat/MessageList.tsx
git commit -m "feat(frontend): componentes MessageBubble e MessageList"
```

---

## Task 15: Frontend — ChannelSidebar + Test

**Files:**
- Create: `web/src/components/chat/ChannelSidebar.tsx`
- Create: `web/src/components/chat/ChannelSidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChannelSidebar } from './ChannelSidebar'
import type { Channel } from '@/hooks/useChannels'

const mockChannels: Channel[] = [
  { ID: 'ch-geral', Name: 'geral', Type: 'text', UserLimit: 0, Bitrate: 0, CreatedAt: '' },
  { ID: 'ch-dev', Name: 'dev', Type: 'text', UserLimit: 0, Bitrate: 0, CreatedAt: '' },
  { ID: 'ch-voz', Name: 'Voz Geral', Type: 'voice', UserLimit: 10, Bitrate: 64000, CreatedAt: '' },
]

describe('ChannelSidebar', () => {
  it('renderiza canais de texto e voz separados', () => {
    render(
      <ChannelSidebar
        textChannels={mockChannels.filter((c) => c.Type === 'text')}
        voiceChannels={mockChannels.filter((c) => c.Type === 'voice')}
        activeChannelId="ch-geral"
        onSelectChannel={vi.fn()}
        onJoinVoice={vi.fn()}
      />
    )

    expect(screen.getByText('geral')).toBeInTheDocument()
    expect(screen.getByText('dev')).toBeInTheDocument()
    expect(screen.getByText('Voz Geral')).toBeInTheDocument()
  })

  it('chama onSelectChannel ao clicar em canal de texto', async () => {
    const onSelect = vi.fn()
    render(
      <ChannelSidebar
        textChannels={mockChannels.filter((c) => c.Type === 'text')}
        voiceChannels={[]}
        activeChannelId="ch-geral"
        onSelectChannel={onSelect}
        onJoinVoice={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText('dev'))
    expect(onSelect).toHaveBeenCalledWith('ch-dev')
  })

  it('chama onJoinVoice ao clicar em canal de voz', async () => {
    const onJoinVoice = vi.fn()
    render(
      <ChannelSidebar
        textChannels={[]}
        voiceChannels={mockChannels.filter((c) => c.Type === 'voice')}
        activeChannelId=""
        onSelectChannel={vi.fn()}
        onJoinVoice={onJoinVoice}
      />
    )

    await userEvent.click(screen.getByText('Voz Geral'))
    expect(onJoinVoice).toHaveBeenCalledWith('ch-voz')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx --prefix web vitest run src/components/chat/ChannelSidebar.test.tsx
```

- [ ] **Step 3: Implement ChannelSidebar**

```tsx
import type { Channel } from '@/hooks/useChannels'

interface ChannelSidebarProps {
  textChannels: Channel[]
  voiceChannels: Channel[]
  activeChannelId: string
  onSelectChannel: (id: string) => void
  onJoinVoice: (id: string) => void
}

export function ChannelSidebar({
  textChannels,
  voiceChannels,
  activeChannelId,
  onSelectChannel,
  onJoinVoice,
}: ChannelSidebarProps) {
  return (
    <div className="w-64 bg-base-300 flex flex-col h-full">
      <div className="p-4 font-bold text-lg border-b border-base-content/10">
        Yerl
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {textChannels.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase text-base-content/50 px-2 mb-1">
              Canais de texto
            </h3>
            {textChannels.map((ch) => (
              <button
                key={ch.ID}
                type="button"
                onClick={() => onSelectChannel(ch.ID)}
                className={`w-full text-left px-2 py-1 rounded text-sm hover:bg-base-200 ${
                  activeChannelId === ch.ID ? 'bg-base-200 font-semibold' : ''
                }`}
              >
                # {ch.Name}
              </button>
            ))}
          </div>
        )}

        {voiceChannels.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase text-base-content/50 px-2 mb-1">
              Canais de voz
            </h3>
            {voiceChannels.map((ch) => (
              <button
                key={ch.ID}
                type="button"
                onClick={() => onJoinVoice(ch.ID)}
                className="w-full text-left px-2 py-1 rounded text-sm hover:bg-base-200"
              >
                {ch.Name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx --prefix web vitest run src/components/chat/ChannelSidebar.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/chat/ChannelSidebar.tsx web/src/components/chat/ChannelSidebar.test.tsx
git commit -m "feat(frontend): componente ChannelSidebar com testes"
```

---

## Task 16: Frontend — ChatArea + Test

**Files:**
- Create: `web/src/components/chat/ChatArea.tsx`
- Create: `web/src/components/chat/ChatArea.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatArea } from './ChatArea'
import type { ChatMessage } from '@/hooks/useChatSocket'

const mockMessages: ChatMessage[] = [
  { id: 'msg-1', channelId: 'ch-geral', senderId: 'u1', senderName: 'Paulo', content: 'oi!', createdAt: '2026-03-30T10:00:00Z' },
  { id: 'msg-2', channelId: 'ch-geral', senderId: 'u2', senderName: 'Joao', content: 'e ai', createdAt: '2026-03-30T10:01:00Z' },
]

describe('ChatArea', () => {
  it('renderiza nome do canal e mensagens', () => {
    render(<ChatArea channelName="geral" messages={mockMessages} onSendMessage={vi.fn()} />)

    expect(screen.getByText('# geral')).toBeInTheDocument()
    expect(screen.getByText('oi!')).toBeInTheDocument()
    expect(screen.getByText('e ai')).toBeInTheDocument()
  })

  it('envia mensagem pelo input', async () => {
    const onSend = vi.fn()
    render(<ChatArea channelName="geral" messages={[]} onSendMessage={onSend} />)

    const input = screen.getByPlaceholderText(/mensagem/i)
    await userEvent.type(input, 'nova msg{enter}')

    expect(onSend).toHaveBeenCalledWith('nova msg')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx --prefix web vitest run src/components/chat/ChatArea.test.tsx
```

- [ ] **Step 3: Implement ChatArea**

```tsx
import type { ChatMessage } from '@/hooks/useChatSocket'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'

interface ChatAreaProps {
  channelName: string
  messages: ChatMessage[]
  onSendMessage: (content: string) => void
}

export function ChatArea({ channelName, messages, onSendMessage }: ChatAreaProps) {
  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-4 py-3 border-b border-base-300 font-semibold">
        # {channelName}
      </div>
      <MessageList messages={messages} />
      <MessageInput onSend={onSendMessage} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx --prefix web vitest run src/components/chat/ChatArea.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/chat/ChatArea.tsx web/src/components/chat/ChatArea.test.tsx
git commit -m "feat(frontend): componente ChatArea com testes"
```

---

## Task 17: Frontend — Rewrite /app Route

**Files:**
- Modify: `web/src/routes/app.tsx`

- [ ] **Step 1: Rewrite app.tsx**

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useChannels } from '@/hooks/useChannels'
import { useChatSocket } from '@/hooks/useChatSocket'
import { ChannelSidebar } from '@/components/chat/ChannelSidebar'
import { ChatArea } from '@/components/chat/ChatArea'

export const Route = createFileRoute('/app')({
  component: AppPage,
})

function AppPage() {
  const navigate = useNavigate()
  const { textChannels, voiceChannels, isLoading } = useChannels()
  const { connected, subscribe, unsubscribe, sendMessage, getMessages } = useChatSocket()
  const [activeChannelId, setActiveChannelId] = useState('')

  // Auto-select first text channel
  useEffect(() => {
    if (!activeChannelId && textChannels.length > 0) {
      setActiveChannelId(textChannels[0].ID)
    }
  }, [textChannels, activeChannelId])

  // Subscribe/unsubscribe when active channel changes
  useEffect(() => {
    if (!activeChannelId || !connected) return
    subscribe(activeChannelId)
    return () => {
      unsubscribe(activeChannelId)
    }
  }, [activeChannelId, connected, subscribe, unsubscribe])

  const activeChannel = textChannels.find((c) => c.ID === activeChannelId)
  const messages = getMessages(activeChannelId)

  const handleSelectChannel = (id: string) => {
    setActiveChannelId(id)
  }

  const handleJoinVoice = (id: string) => {
    void navigate({ to: '/canal', search: { name: id } })
  }

  const handleSendMessage = (content: string) => {
    sendMessage(activeChannelId, content)
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      <ChannelSidebar
        textChannels={textChannels}
        voiceChannels={voiceChannels}
        activeChannelId={activeChannelId}
        onSelectChannel={handleSelectChannel}
        onJoinVoice={handleJoinVoice}
      />
      {activeChannel ? (
        <ChatArea
          channelName={activeChannel.Name}
          messages={messages}
          onSendMessage={handleSendMessage}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-base-content/50">
          Selecione um canal
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add web/src/routes/app.tsx
git commit -m "feat(frontend): reescrever /app com sidebar de canais e chat real"
```

---

## Task 18: Full Integration Test

**Files:** none (verification only)

- [ ] **Step 1: Run all Go tests**

```bash
go test ./...
```

Expected: all pass.

- [ ] **Step 2: Run all frontend tests**

```bash
npm --prefix web run test
```

Expected: all pass.

- [ ] **Step 3: Build the full binary**

```bash
make build
```

Expected: successful build producing `bin/yerl`.

- [ ] **Step 4: Manual smoke test**

```bash
make dev
```

Open browser:
1. Go to `http://localhost:5173/register` — create account
2. Go to `http://localhost:5173/login` — login
3. Should redirect to `/app`
4. Sidebar shows "geral", "dev" (text) and "Voz Geral" (voice)
5. "geral" is auto-selected — history loads (empty initially)
6. Type a message → appears instantly
7. Open second tab with same account → messages appear in both tabs
8. Click "Voz Geral" → navigates to `/canal?name=ch-voz`

- [ ] **Step 5: Commit any fixes from smoke test**

Only if needed.

---

## Task 19: Open Pull Request

**Files:** none (git operations only)

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/app-chat
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "feat: app principal com canais e chat em tempo real" --body "$(cat <<'EOF'
## Summary

- GET /api/channels — lista canais do banco (seed com geral, dev, Voz Geral)
- GET /api/ws/chat — WebSocket dedicado para chat com protocolo subscribe/send-message/history
- Frontend /app reescrito: sidebar com canais reais, chat em tempo real, navegacao para canais de voz
- ChatHub + ChatClient com padrao canonico gorilla/websocket (read/write pumps)
- MessageHandler REST removido — mensagens sao enviadas exclusivamente via WebSocket

## Test plan

- [ ] Go tests: `go test ./...`
- [ ] Frontend tests: `npm --prefix web run test`
- [ ] Build completo: `make build`
- [ ] Smoke test: registrar, logar, enviar mensagens em /app, abrir 2 abas e verificar tempo real
- [ ] Clicar em canal de voz e verificar redirecionamento para /canal

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
