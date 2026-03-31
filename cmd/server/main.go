package main

import (
	"database/sql"
	"log/slog"
	"net/http"
	"os"

	"github.com/PauloHFS/yerl/internal/repository/sqlite"
	"github.com/PauloHFS/yerl/internal/service"
	"github.com/PauloHFS/yerl/internal/service/sfu"
	transporthttp "github.com/PauloHFS/yerl/internal/transport/http"
	"github.com/PauloHFS/yerl/migrations"

	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

func getEnvOrDefault(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

// @title           Yerl API
// @version         1.0
// @description     This is the Yerl (Discord clone) backend API.
// @host            localhost:8080
// @BasePath        /

func main() {
	// Ignora erro no godotenv pois em produção pode não existir o arquivo .env e vir via sistema
	_ = godotenv.Load()

	port := getEnvOrDefault("PORT", "8080")
	dbPath := getEnvOrDefault("DB_PATH", "./yerl.db")
	appEnv := getEnvOrDefault("APP_ENV", "development")

	// Configura o logger estruturado (JSON) como padrão
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With(
		slog.String("service", "yerl-backend"),
		slog.String("env", appEnv),
	)
	slog.SetDefault(logger)

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		slog.Error("erro_abrir_db", slog.Any("error", err))
		os.Exit(1)
	}
	defer db.Close()

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("sqlite3"); err != nil {
		slog.Error("erro_goose_dialeto", slog.Any("error", err))
		os.Exit(1)
	}
	if err := goose.Up(db, "."); err != nil {
		slog.Error("erro_executar_migracoes", slog.Any("error", err))
		os.Exit(1)
	}

	accountRepo := sqlite.NewAccountRepository(db)
	accountService := service.NewAccountService(accountRepo)
	accountHandler := transporthttp.NewAccountHandler(accountService)

	messageRepo := sqlite.NewMessageRepository(db)
	messageService := service.NewMessageService(messageRepo)
	messageHandler := transporthttp.NewMessageHandler(messageService)

	roomManager := sfu.NewRoomManager()
	sfuHandler := transporthttp.NewSFUHandler(roomManager)

	router := transporthttp.NewRouter(accountHandler, messageHandler, sfuHandler)

	slog.Info("server_starting", slog.String("addr", ":"+port))
	if err := http.ListenAndServe(":"+port, router); err != nil {
		slog.Error("server_failed", slog.Any("error", err))
		os.Exit(1)
	}
}
