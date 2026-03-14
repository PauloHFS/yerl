package sqlite

import (
	"context"
	"database/sql"

	"github.com/PauloHFS/yerl/internal/domain"
)

type accountRepository struct {
	db *sql.DB
}

func NewAccountRepository(db *sql.DB) domain.AccountRepository {
	return &accountRepository{db: db}
}

func (r *accountRepository) Create(ctx context.Context, acc *domain.Account) error {
	query := `INSERT INTO accounts (id, name, email, password_hash) VALUES (?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, acc.ID, acc.Name, acc.Email, acc.PasswordHash)
	return err
}

func (r *accountRepository) FindByEmail(ctx context.Context, email string) (*domain.Account, error) {
	query := `SELECT id, email, password_hash FROM accounts WHERE email = ?`
	row := r.db.QueryRowContext(ctx, query, email)

	var acc domain.Account
	err := row.Scan(&acc.ID, &acc.Email, &acc.PasswordHash)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &acc, nil
}
