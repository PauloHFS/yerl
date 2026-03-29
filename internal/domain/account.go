package domain

import (
	"context"
	"time"
)

//go:generate mockgen -destination=../mock/account_mock.go -package=mock -source=account.go

type Account struct {
	ID           string
	Name         string
	Email        string
	PasswordHash string
	CreatedAt    time.Time
}

type AccountRepository interface {
	Create(ctx context.Context, acc *Account) error
	FindByEmail(ctx context.Context, email string) (*Account, error)
}

type AccountService interface {
	Register(ctx context.Context, name, email, password string) error
	Login(ctx context.Context, email, password string) (string, error)
}
