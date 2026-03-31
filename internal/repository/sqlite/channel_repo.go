package sqlite

import (
	"context"
	"database/sql"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/PauloHFS/yerl/internal/repository/sqlite/sqlc"
)

type channelRepository struct {
	queries *sqlc.Queries
}

func NewChannelRepository(db *sql.DB) domain.ChannelRepository {
	return &channelRepository{
		queries: sqlc.New(db),
	}
}

func (r *channelRepository) ListAll(ctx context.Context) ([]*domain.Channel, error) {
	rows, err := r.queries.ListAllChannels(ctx)
	if err != nil {
		return nil, err
	}

	channels := make([]*domain.Channel, 0, len(rows))
	for _, row := range rows {
		channels = append(channels, &domain.Channel{
			ID:        row.ID,
			Name:      row.Name,
			Type:      row.Type,
			UserLimit: int(row.UserLimit),
			Bitrate:   int(row.Bitrate),
			CreatedAt: row.CreatedAt,
		})
	}

	return channels, nil
}
