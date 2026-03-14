package http

import (
	"net/http"
)

func NewRouter(
	accountHandler *AccountHandler,
	messageHandler *MessageHandler,
) *http.ServeMux {
	mux := http.NewServeMux()

	// Agrupamento de rotas do domínio Account
	mux.HandleFunc("POST /api/accounts/register", accountHandler.Register)
	mux.HandleFunc("POST /api/accounts/login", accountHandler.Login)

	// Agrupamento de rotas do domínio Message
	mux.HandleFunc("POST /api/messages", messageHandler.Send)

	return mux
}
