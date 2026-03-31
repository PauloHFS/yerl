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
