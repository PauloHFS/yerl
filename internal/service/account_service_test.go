package service

import (
	"context"
	"testing"

	"github.com/PauloHFS/yerl/internal/mock"
	"github.com/stretchr/testify/assert"
	"go.uber.org/mock/gomock"
)

func TestRegister_Success(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mock.NewMockAccountRepository(ctrl)
	svc := NewAccountService(mockRepo)

	mockRepo.EXPECT().
		FindByEmail(gomock.Any(), "test@test.com").
		Return(nil, nil).
		Times(1)

	mockRepo.EXPECT().
		Create(gomock.Any(), gomock.Any()).
		Return(nil).
		Times(1)

	err := svc.Register(context.Background(), "sementinha", "test@test.com", "password123")

	assert.NoError(t, err)
}
