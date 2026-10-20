-- v1.3: salas privadas de póker y blackjack.
CREATE TABLE rooms (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  code_expires_at  TEXT NOT NULL,
  name             TEXT NOT NULL,
  game             TEXT NOT NULL CHECK (game IN ('poker', 'blackjack')),
  host_id          TEXT NOT NULL REFERENCES users(id),
  privacy          TEXT NOT NULL CHECK (privacy IN ('code', 'friends')),
  max_seats        INTEGER NOT NULL,
  allow_bots       INTEGER NOT NULL DEFAULT 0,
  chip_mode        TEXT NOT NULL DEFAULT 'wallet' CHECK (chip_mode IN ('wallet', 'room')),
  settings_json    TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  created_at       TEXT NOT NULL,
  closed_at        TEXT,
  close_reason     TEXT
);
CREATE INDEX idx_rooms_status ON rooms(status);

CREATE TABLE room_members (
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_room_members_user ON room_members(user_id);

-- Invitaciones nominales enviadas a amigos (permiten entrar sin escribir el código).
CREATE TABLE room_invites (
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

-- Las mesas de las salas privadas no están en poker_tables: los asientos con
-- fichas del monedero se registran igualmente (para reembolsarlos si el
-- servidor se reinicia), así que la referencia a poker_tables se elimina.
CREATE TABLE poker_seats_v2 (
  table_id   TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stack      INTEGER NOT NULL CHECK (stack >= 0),
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (table_id, seat),
  UNIQUE (table_id, user_id)
);
INSERT INTO poker_seats_v2 (table_id, seat, user_id, stack, joined_at) SELECT table_id, seat, user_id, stack, joined_at FROM poker_seats;
DROP TABLE poker_seats;
ALTER TABLE poker_seats_v2 RENAME TO poker_seats;
