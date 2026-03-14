package domain

import "context"

type Account struct {
	ID           string
	Name         string
	Email        string
	PasswordHash string
}

type AccountRepository interface {
	Create(ctx context.Context, acc *Account) error
	FindByEmail(ctx context.Context, email string) (*Account, error)
}

type AccountService interface {
	Register(ctx context.Context, name, email, password string) error
}
