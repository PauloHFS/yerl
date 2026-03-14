package sqlite

import (
	"context"
	"database/sql"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/PauloHFS/yerl/internal/repository/sqlite/sqlc"
)

type messageRepository struct {
	db      *sql.DB
	queries *sqlc.Queries
}

func NewMessageRepository(db *sql.DB) domain.MessageRepository {
	return &messageRepository{
		db:      db,
		queries: sqlc.New(db),
	}
}

func (r *messageRepository) Create(ctx context.Context, msg *domain.Message) error {
	return r.queries.CreateMessage(ctx, sqlc.CreateMessageParams{
		ID:        msg.ID,
		ChannelID: msg.ChannelID,
		SenderID:  msg.SenderID,
		Content:   msg.Content,
		CreatedAt: msg.CreatedAt,
	})
}

func (r *messageRepository) GetByChannelID(ctx context.Context, channelID string, limit, offset int) ([]*domain.Message, error) {
	rows, err := r.queries.GetMessagesByChannelID(ctx, sqlc.GetMessagesByChannelIDParams{
		ChannelID: channelID,
		Limit:     int64(limit),
		Offset:    int64(offset),
	})
	if err != nil {
		return nil, err
	}

	var messages []*domain.Message
	for _, row := range rows {
		messages = append(messages, &domain.Message{
			ID:        row.ID,
			ChannelID: row.ChannelID,
			SenderID:  row.SenderID,
			Content:   row.Content,
			CreatedAt: row.CreatedAt,
		})
	}

	return messages, nil
}
