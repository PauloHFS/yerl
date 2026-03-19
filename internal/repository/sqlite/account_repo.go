package sqlite

import (
	"context"
	"database/sql"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/PauloHFS/yerl/internal/repository/sqlite/sqlc"
)

type accountRepository struct {
	db      *sql.DB
	queries *sqlc.Queries
}

func NewAccountRepository(db *sql.DB) domain.AccountRepository {
	return &accountRepository{
		db:      db,
		queries: sqlc.New(db),
	}
}

func (r *accountRepository) Create(ctx context.Context, acc *domain.Account) error {
	return r.queries.CreateAccount(ctx, sqlc.CreateAccountParams{
		ID:           acc.ID,
		Name:         acc.Name,
		Email:        acc.Email,
		PasswordHash: acc.PasswordHash,
		CreatedAt:    acc.CreatedAt,
	})
}

func (r *accountRepository) FindByEmail(ctx context.Context, email string) (*domain.Account, error) {
	row, err := r.queries.GetAccountByEmail(ctx, email)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	return &domain.Account{
		ID:           row.ID,
		Name:         row.Name,
		Email:        row.Email,
		PasswordHash: row.PasswordHash,
		CreatedAt:    row.CreatedAt,
	}, nil
}
