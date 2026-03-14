APP_NAME=yerl
MAIN_PATH=cmd/server/main.go
DB_PATH=./yerl.db
MIGRATIONS_DIR=migrations
WEB_DIR=web

.PHONY: all build run dev install-web clean test lint sqlc new-migration tidy generate help

all: build

help: ## Exibe esta mensagem de ajuda
	@echo "Uso: make [alvo]"
	@echo ""
	@echo "Alvos disponíveis:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Compila o binário do backend (embutindo o frontend gerado)
	npm --prefix $(WEB_DIR) run build
	CGO_ENABLED=0 go build -ldflags="-w -s" -o bin/$(APP_NAME) $(MAIN_PATH)

run: ## Executa o backend isoladamente
	go run $(MAIN_PATH)

dev: ## Inicia o backend (Go) e o frontend (Vite) simultaneamente
	npx concurrently -k -p "[{name}]" -n "API,WEB" -c "cyan.bold,green.bold" "go run $(MAIN_PATH)" "npm --prefix $(WEB_DIR) run dev"

install-web: ## Instala as dependências do frontend (node_modules)
	npm --prefix $(WEB_DIR) install

clean: ## Remove binários e dependências locais
	rm -rf bin/
	rm -rf $(WEB_DIR)/node_modules/

test: ## Executa todos os testes do projeto Go
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