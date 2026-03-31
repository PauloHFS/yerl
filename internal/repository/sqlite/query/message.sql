-- name: CreateMessage :exec
INSERT INTO messages (id, channel_id, sender_id, content, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetMessagesByChannelID :many
SELECT id, channel_id, sender_id, content, created_at
FROM messages
WHERE channel_id = ?
ORDER BY created_at DESC
LIMIT ? OFFSET ?;

-- name: GetMessagesByChannelIDWithSender :many
SELECT m.id, m.channel_id, m.sender_id, a.name as sender_name, m.content, m.created_at
FROM messages m
JOIN accounts a ON m.sender_id = a.id
WHERE m.channel_id = ?
ORDER BY m.created_at DESC
LIMIT ? OFFSET ?;