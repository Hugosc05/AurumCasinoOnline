-- v1.8: foto de perfil, cosméticos, misiones y cajas.

CREATE TABLE user_profiles (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar_mime      TEXT,
  avatar_data      TEXT,
  avatar_version   INTEGER NOT NULL DEFAULT 0,
  frame            TEXT,
  name_color       TEXT,
  card_back        TEXT,
  updated_at       TEXT NOT NULL
);

-- Cosméticos conseguidos (sin repetidos: un repetido se convierte en créditos).
CREATE TABLE user_items (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

-- Cajas: ganadas con misiones o compradas; el premio se sortea al abrir.
CREATE TABLE user_cases (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id      TEXT NOT NULL,
  source       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('unopened', 'opened')),
  result_json  TEXT,
  created_at   TEXT NOT NULL,
  opened_at    TEXT
);
CREATE INDEX idx_user_cases_user ON user_cases(user_id, status);

-- Misiones del periodo (día local o semana ISO) con su progreso.
CREATE TABLE user_missions (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period       TEXT NOT NULL,
  mission_id   TEXT NOT NULL,
  target       INTEGER NOT NULL,
  progress     INTEGER NOT NULL DEFAULT 0,
  state_json   TEXT,
  claimed      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period, mission_id)
);
