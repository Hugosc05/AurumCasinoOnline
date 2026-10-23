-- v1.7: bingo, cohete (crash) y plinko.
-- SQLite no permite cambiar un CHECK con ALTER TABLE: se reconstruyen las tablas
-- copiando los datos (nada referencia a game_rounds; rooms se reconstruye junto con
-- sus tablas hijas para no disparar los borrados en cascada).

CREATE TABLE game_rounds_v2 (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game             TEXT NOT NULL CHECK (game IN ('blackjack', 'roulette', 'slots', 'poker', 'bingo', 'crash', 'plinko')),
  status           TEXT NOT NULL CHECK (status IN ('open', 'settled', 'void')),
  bet_total        INTEGER NOT NULL DEFAULT 0,
  payout           INTEGER NOT NULL DEFAULT 0,
  idempotency_key  TEXT,
  action_seq       INTEGER NOT NULL DEFAULT 0,
  state_json       TEXT,
  result_json      TEXT,
  created_at       TEXT NOT NULL,
  settled_at       TEXT,
  UNIQUE (user_id, idempotency_key)
);
INSERT INTO game_rounds_v2 (id, user_id, game, status, bet_total, payout, idempotency_key, action_seq, state_json, result_json, created_at, settled_at)
  SELECT id, user_id, game, status, bet_total, payout, idempotency_key, action_seq, state_json, result_json, created_at, settled_at FROM game_rounds;
DROP TABLE game_rounds;
ALTER TABLE game_rounds_v2 RENAME TO game_rounds;
CREATE INDEX idx_rounds_user ON game_rounds(user_id, created_at DESC);
CREATE INDEX idx_rounds_game ON game_rounds(game, created_at DESC);
CREATE INDEX idx_rounds_open ON game_rounds(user_id, game, status);

CREATE TABLE rooms_v2 (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  code_expires_at  TEXT NOT NULL,
  name             TEXT NOT NULL,
  game             TEXT NOT NULL CHECK (game IN ('poker', 'blackjack', 'bingo')),
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
INSERT INTO rooms_v2 (id, code, code_expires_at, name, game, host_id, privacy, max_seats, allow_bots, chip_mode, settings_json, status, created_at, closed_at, close_reason)
  SELECT id, code, code_expires_at, name, game, host_id, privacy, max_seats, allow_bots, chip_mode, settings_json, status, created_at, closed_at, close_reason FROM rooms;

CREATE TABLE room_members_v2 (
  room_id    TEXT NOT NULL REFERENCES rooms_v2(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
INSERT INTO room_members_v2 (room_id, user_id, joined_at) SELECT room_id, user_id, joined_at FROM room_members;

CREATE TABLE room_invites_v2 (
  room_id     TEXT NOT NULL REFERENCES rooms_v2(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
INSERT INTO room_invites_v2 (room_id, user_id, invited_by, created_at) SELECT room_id, user_id, invited_by, created_at FROM room_invites;

DROP TABLE room_invites;
DROP TABLE room_members;
DROP TABLE rooms;
ALTER TABLE rooms_v2 RENAME TO rooms;
ALTER TABLE room_members_v2 RENAME TO room_members;
ALTER TABLE room_invites_v2 RENAME TO room_invites;
CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_room_members_user ON room_members(user_id);

-- Rondas del cohete: semilla secreta (se publica su hash antes de apostar y la semilla al terminar).
CREATE TABLE crash_rounds (
  round_no     INTEGER PRIMARY KEY,
  seed_hash    TEXT NOT NULL,
  seed         TEXT,
  crash_point  INTEGER,
  started_at   TEXT,
  ended_at     TEXT
);
