package service

import (
	"context"
	"errors"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type accountService struct {
	repo domain.AccountRepository
}

func NewAccountService(repo domain.AccountRepository) domain.AccountService {
	return &accountService{repo: repo}
}

func (s *accountService) Register(ctx context.Context, name, email, password string) error {
	existing, _ := s.repo.FindByEmail(ctx, email)
	if existing != nil {
		return errors.New("email em uso")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	acc := &domain.Account{
		ID:           uuid.New().String(),
		Name:         name,
		Email:        email,
		PasswordHash: string(hash),
	}

	return s.repo.Create(ctx, acc)
}
