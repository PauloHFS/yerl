package main

import (
	"database/sql"
	"log"
	"net/http"

	"github.com/PauloHFS/yerl/internal/repository/sqlite"
	"github.com/PauloHFS/yerl/internal/service"
	transporthttp "github.com/PauloHFS/yerl/internal/transport/http"
	"github.com/PauloHFS/yerl/migrations"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

func main() {
	db, err := sql.Open("sqlite", "./yerl.db")
	if err != nil {
		log.Fatal("Erro ao abrir banco de dados:", err)
	}
	defer db.Close()

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("sqlite3"); err != nil {
		log.Fatal("Erro ao definir dialeto do goose:", err)
	}
	if err := goose.Up(db, "."); err != nil {
		log.Fatal("Erro ao executar migrações:", err)
	}

	accountRepo := sqlite.NewAccountRepository(db)
	accountService := service.NewAccountService(accountRepo)
	accountHandler := transporthttp.NewAccountHandler(accountService)

	messageRepo := sqlite.NewMessageRepository(db)
	messageService := service.NewMessageService(messageRepo)
	messageHandler := transporthttp.NewMessageHandler(messageService)

	router := transporthttp.NewRouter(accountHandler, messageHandler)

	log.Println("Server listening on :8080")
	if err := http.ListenAndServe(":8080", router); err != nil {
		log.Fatal(err)
	}
}
