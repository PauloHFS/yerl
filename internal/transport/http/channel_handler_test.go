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
