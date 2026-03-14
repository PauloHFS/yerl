APP_NAME=yerl
MAIN_PATH=cmd/server/main.go
DB_PATH=./yerl.db
MIGRATIONS_DIR=migrations

.PHONY: all build run clean test sqlc new-migration tidy

all: build

build:
	go build -o bin/$(APP_NAME) $(MAIN_PATH)

run:
	go run $(MAIN_PATH)

clean:
	rm -rf bin/

test:
	go test -v ./...

sqlc:
	sqlc generate

new-migration:
	@read -p "Nome da migration: " name; \
	goose -dir $(MIGRATIONS_DIR) sqlite3 $(DB_PATH) create $$name sql

tidy:
	go mod tidy