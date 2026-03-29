package http

import (
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/PauloHFS/yerl/internal/domain"
)

type AccountHandler struct {
	service domain.AccountService
}

func NewAccountHandler(service domain.AccountService) *AccountHandler {
	return &AccountHandler{service: service}
}

type RegisterRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// @Summary      Register an account
// @Description  Creates a new user account with email and password
// @Tags         accounts
// @Accept       json
// @Produce      json
// @Param        request  body      RegisterRequest  true  "Account Registration Data"
// @Success      201      {string}  string "Created"
// @Failure      400      {string}  string "Bad Request"
// @Failure      500      {string}  string "Internal Server Error"
// @Router       /api/register [post]
func (h *AccountHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.service.Register(r.Context(), req.Name, req.Email, req.Password); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

func (h *AccountHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	token, err := h.service.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	isProd := os.Getenv("APP_ENV") == "production"
	http.SetCookie(w, &http.Cookie{
		Name:     "token",
		Value:    token,
		HttpOnly: true,
		Secure:   isProd,
		Path:     "/",
		Expires:  time.Now().Add(24 * time.Hour),
		SameSite: http.SameSiteStrictMode,
	})

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{"message": "login feito com sucesso"}); err != nil {
		http.Error(w, "erro ao serializar resposta", http.StatusInternalServerError)
	}
}
