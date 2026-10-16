-- v1.3: anuncios recompensados (proveedor configurable, verificación en el servidor).

-- Cada intento de ver un anuncio. La recompensa solo se concede una vez por sesión
-- (transición condicional started → rewarded) y una vez por transacción del proveedor.
CREATE TABLE ad_sessions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('started', 'rewarded', 'rejected', 'expired')),
  reward           INTEGER NOT NULL DEFAULT 0,
  day              TEXT NOT NULL,
  provider_tx_id   TEXT UNIQUE,
  reject_reason    TEXT,
  created_at       TEXT NOT NULL,
  completed_at     TEXT
);
CREATE INDEX idx_ad_sessions_user_day ON ad_sessions(user_id, day, status);
