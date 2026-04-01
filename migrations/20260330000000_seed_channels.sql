-- +goose Up
INSERT INTO channels (id, name, type, user_limit, bitrate, created_at)
VALUES
  ('ch-geral', 'geral', 'text', 0, 0, datetime('now')),
  ('ch-dev', 'dev', 'text', 0, 0, datetime('now')),
  ('ch-voz', 'Voz Geral', 'voice', 10, 64000, datetime('now'));

-- +goose Down
DELETE FROM channels WHERE id IN ('ch-geral', 'ch-dev', 'ch-voz');
