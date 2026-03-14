package http

import (
	"net/http"

	"github.com/PauloHFS/yerl/internal/domain"
)

type MessageHandler struct {
	service domain.MessageService
}

func NewMessageHandler(service domain.MessageService) *MessageHandler {
	return &MessageHandler{service: service}
}

func (h *MessageHandler) Send(w http.ResponseWriter, r *http.Request) {
	// Lógica de parse JSON e chamada ao h.service.Send
	w.WriteHeader(http.StatusOK)
}
