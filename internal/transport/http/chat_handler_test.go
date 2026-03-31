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
	"github.com/PauloHFS/yerl/internal/service"
	transporthttp "github.com/PauloHFS/yerl/internal/transport/http"
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
