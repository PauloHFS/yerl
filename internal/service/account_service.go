package service

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/golang-jwt/jwt/v5"
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
		CreatedAt:    time.Now().UTC(),
	}

	return s.repo.Create(ctx, acc)
}

func getJWTSecret() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		// Fallback para desenvolvimento local caso a ENV não esteja setada
		return []byte("super_secret_key")
	}
	return []byte(secret)
}

func generateToken(userID string) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	return token.SignedString(getJWTSecret())
}

func ValidateToken(tokenString string) (string, error) {
	token, err := jwt.Parse(tokenString,
		func(token *jwt.Token) (interface{}, error) {
			return getJWTSecret(), nil
		},
		jwt.WithValidMethods([]string{"HS256"}),
	)
	if err != nil {
		return "", err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return "", errors.New("token inválido")
	}

	userID, ok := claims["user_id"].(string)
	if !ok {
		return "", errors.New("token inválido")
	}

	return userID, nil
}

func (s *accountService) Login(ctx context.Context, email, password string) (string, error) {
	acc, err := s.repo.FindByEmail(ctx, email)
	if err != nil {
		return "", err
	}

	if acc == nil {
		return "", errors.New("credenciais inválidas")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(acc.PasswordHash), []byte(password)); err != nil {
		return "", errors.New("credenciais inválidas")
	}

	return generateToken(acc.ID)
}
