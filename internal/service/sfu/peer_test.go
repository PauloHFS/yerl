package sfu

import (
	"context"
	"testing"

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
