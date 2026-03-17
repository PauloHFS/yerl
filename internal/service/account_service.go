package service

import (
	"context"
	"errors"
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

var jwtSecret = []byte("super_secret_key")

func generateToken(userID string) (string, error) {

	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	return token.SignedString(jwtSecret)
}

func ValidateToken(tokenString string) (string, error) {

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil {
		return "", err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {

		userID, ok := claims["user_id"].(string)
		if !ok {
			return "", errors.New("invalid token")
		}

		return userID, nil
	}

	return "", errors.New("invalid token")
}

func (s *accountService) Login(ctx context.Context, email, password string) (string, error) {
	acc, err := s.repo.FindByEmail(ctx, email)
	if err != nil {
		return "", err
	}

	if acc == nil {
		return "", errors.New("Credenciais Inválidas")
	}

	err = bcrypt.CompareHashAndPassword(
		[]byte(acc.PasswordHash),
		[]byte(password),
	)

	if err != nil {
		return "", errors.New("Credenciais Inválidas")
	}

	//Aqui gera o token
	token, err := generateToken(acc.ID)
	if err != nil {
		return "", err
	}

	return token, nil

}
