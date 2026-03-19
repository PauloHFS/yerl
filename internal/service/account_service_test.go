package service

import (
	"context"
	"testing"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/PauloHFS/yerl/internal/mock"
	"github.com/stretchr/testify/assert"
	"go.uber.org/mock/gomock"
)

func TestRegister_Success_And_Hashes_Password(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mock.NewMockAccountRepository(ctrl)
	svc := NewAccountService(mockRepo)

	// Checa se o email já existe
	mockRepo.EXPECT().
		FindByEmail(gomock.Any(), "test@test.com").
		Return(nil, nil).
		Times(1)

	// Pega a chamada de create pra inspecionar os dados
	mockRepo.EXPECT().
		Create(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, acc *domain.Account) error {
			assert.NotEqual(t, "password123", acc.PasswordHash, "FALHA CRÍTICA: A senha foi salva em texto puro!")
			assert.True(t, len(acc.PasswordHash) > 20, "O hash gerado é muito curto ou inválido")

			// Checa outros dados
			assert.Equal(t, "test@test.com", acc.Email)
			assert.Equal(t, "sementinha", acc.Name)
			assert.NotEmpty(t, acc.ID, "O ID do usuário deveria ter sido gerado")

			return nil
		}).
		Times(1)

	// Executa a ação
	err := svc.Register(context.Background(), "sementinha", "test@test.com", "password123")

	// Verifica se rodou sem erros
	assert.NoError(t, err)
}
