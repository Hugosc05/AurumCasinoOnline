-- v1.3: amistades y notificaciones dentro de la aplicación.

-- Una sola fila por pareja (pair_key = id menor | id mayor): no puede haber
-- solicitudes duplicadas ni relaciones contradictorias en los dos sentidos.
-- Rechazar o cancelar borra la fila; aceptar la marca como 'accepted'.
CREATE TABLE friendships (
  id            TEXT PRIMARY KEY,
  requester_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pair_key      TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at    TEXT NOT NULL,
  responded_at  TEXT,
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX idx_friend_req ON friendships(requester_id, status);
CREATE INDEX idx_friend_addr ON friendships(addressee_id, status);

CREATE TABLE notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  read_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, id);
