-- v1.10: panel de administración ampliado (seguridad, 2FA, actividad, ingresos).

-- Eventos de seguridad: inicios de sesión fallidos, bloqueos, sondeos de vulnerabilidades, 2FA…
CREATE TABLE security_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'high')),
  ip          TEXT,
  user_id     TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_security_events_created ON security_events(created_at);
CREATE INDEX idx_security_events_kind ON security_events(kind, created_at);

-- Usuarios activos por día (día local de dailyTimezone): base de DAU/WAU/MAU y retención.
CREATE TABLE daily_activity (
  day      TEXT NOT NULL,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX idx_daily_activity_user ON daily_activity(user_id, day);

-- Visitas por sección (ruta normalizada) y visitantes únicos por día (clave anónima).
CREATE TABLE page_views (
  day    TEXT NOT NULL,
  path   TEXT NOT NULL,
  views  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
CREATE TABLE daily_visitors (
  day          TEXT NOT NULL,
  visitor_key  TEXT NOT NULL,
  PRIMARY KEY (day, visitor_key)
);
CREATE TABLE site_daily (
  day          TEXT PRIMARY KEY,
  peak_online  INTEGER NOT NULL DEFAULT 0
);

-- Verificación en dos pasos (TOTP) de los administradores.
CREATE TABLE admin_mfa (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret         TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 0,
  recovery_json  TEXT NOT NULL DEFAULT '[]',
  last_step      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  enabled_at     TEXT
);
-- Momento en que la sesión superó el segundo paso (NULL = aún no).
ALTER TABLE sessions ADD COLUMN mfa_at TEXT;

-- Credenciales de servicios externos (AdSense, Telegram…). Solo accesible desde el panel con 2FA.
CREATE TABLE app_secrets (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
