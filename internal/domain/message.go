package domain

import (
	"context"
	"time"
)

//go:generate mockgen -destination=../mock/message_mock.go -package=mock -source=message.go

type Message struct {
	ID        string
	ChannelID string
	SenderID  string
	SenderName	string
	Content   string
	CreatedAt time.Time
}

type MessageRepository interface {
	Create(ctx context.Context, msg *Message) error
	GetByChannelID(ctx context.Context, channelID string, limit, offset int) ([]*Message, error)
}

type MessageService interface {
	Send(ctx context.Context, channelID, senderID, content string) (*Message, error)
	// TODO: Improve pagination by use cursors instead of limit/offset
	GetHistory(ctx context.Context, channelID string, limit, offset int) ([]*Message, error)
}
