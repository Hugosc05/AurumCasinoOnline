-- v1.3: estado de las funciones especiales de las tragaperras por usuario y máquina.
-- Giros gratis pendientes y bono de cofres en curso (con los premios ya fijados por el servidor).
CREATE TABLE slot_sessions (
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_id         TEXT NOT NULL,
  free_spins_left    INTEGER NOT NULL DEFAULT 0 CHECK (free_spins_left >= 0),
  free_spins_total   INTEGER NOT NULL DEFAULT 0,
  bet_per_line       INTEGER NOT NULL DEFAULT 0,
  lines              INTEGER NOT NULL DEFAULT 0,
  feature_win        INTEGER NOT NULL DEFAULT 0,
  bonus_json         TEXT,
  version            INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (user_id, machine_id)
);
