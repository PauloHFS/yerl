-- name: CreateAccount :exec
INSERT INTO accounts (id, name, email, password_hash, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetAccountByEmail :one
SELECT id, name, email, password_hash, created_at
FROM accounts
WHERE email = ?;