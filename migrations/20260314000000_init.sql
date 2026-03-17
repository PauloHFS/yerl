-- +goose Up
-- Trocado de users para accounts, para padronizar o código, caso no futuro vá ser mudado, será necessário alterar alguns arquivos no backend também
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

-- +goose Down
DROP TABLE messages;
DROP TABLE channels;
DROP TABLE accounts;