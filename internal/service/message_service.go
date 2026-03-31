package service

import (
	"context"
	"errors"
	"time"

	"github.com/PauloHFS/yerl/internal/domain"

	"github.com/google/uuid"
)

type messageService struct {
	repo domain.MessageRepository
}

func NewMessageService(repo domain.MessageRepository) domain.MessageService {
	return &messageService{repo: repo}
}

func (s *messageService) Send(ctx context.Context, channelID, senderID, content string) (*domain.Message, error) {
	if content == "" {
		return nil, errors.New("conteúdo inválido")
	}

	msg := &domain.Message{
		ID:        uuid.New().String(),
		ChannelID: channelID,
		SenderID:  senderID,
		Content:   content,
		CreatedAt: time.Now().UTC(),
	}

	if err := s.repo.Create(ctx, msg); err != nil {
		return nil, err
	}

	return msg, nil
}

// TODO: Improve pagination by use cursors instead of limit/offset
func (s *messageService) GetHistory(ctx context.Context, channelID string, limit, offset int) ([]*domain.Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repo.GetByChannelIDWithSender(ctx, channelID, limit, offset)
}
