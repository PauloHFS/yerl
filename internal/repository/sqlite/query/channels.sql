-- name: ListVoiceChannels :many
SELECT id, name, type, user_limit, bitrate, created_at
FROM channels
WHERE type = 'voice'
ORDER BY created_at ASC;

-- name: CreateVoiceChannel :one
INSERT INTO channels (id, name, type, user_limit, bitrate, created_at)
VALUES (?, ?, 'voice', ?, ?, ?)
RETURNING *;
