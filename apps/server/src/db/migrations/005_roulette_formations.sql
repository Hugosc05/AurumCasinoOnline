-- v1.3: formaciones de apuestas de ruleta guardadas por cada usuario.
CREATE TABLE roulette_formations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL,
  bets_json   TEXT NOT NULL,
  total       INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (user_id, name_key)
);
CREATE INDEX idx_formations_user ON roulette_formations(user_id, updated_at);
