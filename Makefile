APP_NAME=yerl
MAIN_PATH=cmd/server/main.go
DB_PATH=./yerl.db
MIGRATIONS_DIR=migrations

.PHONY: all build run clean test lint sqlc new-migration tidy generate help

all: build

help: ## Exibe esta mensagem de ajuda
	@echo "Uso: make [alvo]"
	@echo ""
	@echo "Alvos disponíveis:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Compila o binário da aplicação (CGO desativado)
	CGO_ENABLED=0 go build -ldflags="-w -s" -o bin/$(APP_NAME) $(MAIN_PATH)

run: ## Executa a aplicação diretamente
	go run $(MAIN_PATH)

clean: ## Remove o diretório de binários
	rm -rf bin/

test: ## Executa todos os testes do projeto
	go test -v ./...

lint: ## Executa o golangci-lint
	golangci-lint run

sqlc: ## Gera o código Go type-safe das queries SQL
	sqlc generate

new-migration: ## Cria um novo arquivo de migração em branco
	@read -p "Nome da migration: " name; \
	goose -dir $(MIGRATIONS_DIR) sqlite3 $(DB_PATH) create $$name sql

tidy: ## Sincroniza as dependências do go.mod
	go mod tidy

generate: ## Executa todas as diretivas go:generate (inclui mockgen)
	go generate ./...