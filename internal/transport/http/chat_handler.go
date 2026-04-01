package http

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/PauloHFS/yerl/internal/service"
	"github.com/gorilla/websocket"
)

type ChatHandler struct {
	messageService domain.MessageService
	channelRepo    domain.ChannelRepository
	hub            *ChatHub
	validChannels  map[string]bool
	channelsMu     sync.RWMutex
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
	channels, err := h.channelRepo.ListAll(context.Background())
	if err != nil {
		slog.Error("chat: erro ao carregar canais", "err", err)
		return
	}
	valid := make(map[string]bool, len(channels))
	for _, ch := range channels {
		valid[ch.ID] = true
	}
	h.channelsMu.Lock()
	h.validChannels = valid
	h.channelsMu.Unlock()
}

var chatUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		return origin == "https://"+r.Host || origin == "http://"+r.Host
	},
}

func (h *ChatHandler) HandleWS(w http.ResponseWriter, r *http.Request) {
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

	h.loadChannels()

	conn, err := chatUpgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("chat ws upgrade error", "err", err)
		return
	}

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
		h.channelsMu.RLock()
		valid := h.validChannels[payload.ChannelID]
		h.channelsMu.RUnlock()
		if !valid {
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "canal nao encontrado"}})
			return
		}
		h.hub.Subscribe <- Subscription{Client: client, ChannelID: payload.ChannelID}
		h.sendHistory(client, payload.ChannelID, 50, 0)

	case "unsubscribe":
		var payload subscribePayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			slog.Warn("chat: payload inválido", "type", msg.Type, "user_id", client.UserID, "err", err)
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "payload inválido"}})
			return
		}
		h.hub.Unsubscribe <- Subscription{Client: client, ChannelID: payload.ChannelID}

	case "send-message":
		var payload sendMessagePayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "payload invalido"}})
			return
		}
		h.channelsMu.RLock()
		validCh := h.validChannels[payload.ChannelID]
		h.channelsMu.RUnlock()
		if !validCh {
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
		data, err := json.Marshal(broadcast)
		if err != nil {
			slog.Error("chat: erro ao serializar broadcast", "err", err)
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "erro interno"}})
			return
		}
		h.hub.Broadcast <- BroadcastMessage{ChannelID: payload.ChannelID, Data: data}

	case "get-history":
		var payload getHistoryPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			slog.Warn("chat: payload inválido", "type", msg.Type, "user_id", client.UserID, "err", err)
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "payload inválido"}})
			return
		}
		h.channelsMu.RLock()
		validHist := h.validChannels[payload.ChannelID]
		h.channelsMu.RUnlock()
		if !validHist {
			client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "canal nao encontrado"}})
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
		slog.Error("chat: erro ao buscar histórico", "channel_id", channelID, "err", err)
		client.SendJSON(ChatResponse{Type: "error", Payload: errorPayload{Message: "erro ao carregar histórico do canal"}})
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
