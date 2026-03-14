-- name: CreateMessage :exec
INSERT INTO messages (id, channel_id, sender_id, content, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetMessagesByChannelID :many
SELECT id, channel_id, sender_id, content, created_at
FROM messages
WHERE channel_id = ?
ORDER BY created_at DESC
LIMIT ? OFFSET ?;