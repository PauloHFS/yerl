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
