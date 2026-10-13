-- Aurum Casino — esquema inicial.
-- SQL compatible con SQLite y fácilmente portable a PostgreSQL
-- (TEXT para identificadores UUID, INTEGER para importes en créditos enteros).

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email          TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  balance        INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  prefs_json     TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);

CREATE TABLE sessions (
  id_hash       TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Libro mayor del monedero virtual: cada movimiento con saldo anterior y posterior.
CREATE TABLE wallet_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL,
  balance_before  INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  reason          TEXT NOT NULL,
  round_id        TEXT,
  unlimited       INTEGER NOT NULL DEFAULT 0,
  meta_json       TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_wallet_user ON wallet_transactions(user_id, id DESC);
CREATE INDEX idx_wallet_round ON wallet_transactions(round_id);

CREATE TABLE game_rounds (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game             TEXT NOT NULL CHECK (game IN ('blackjack', 'roulette', 'slots', 'poker')),
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
CREATE INDEX idx_rounds_user ON game_rounds(user_id, created_at DESC);
CREATE INDEX idx_rounds_game ON game_rounds(game, created_at DESC);
CREATE INDEX idx_rounds_open ON game_rounds(user_id, game, status);

CREATE TABLE blackjack_shoes (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cards_json  TEXT NOT NULL,
  size        INTEGER NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE user_stats (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rounds          INTEGER NOT NULL DEFAULT 0,
  wins            INTEGER NOT NULL DEFAULT 0,
  losses          INTEGER NOT NULL DEFAULT 0,
  pushes          INTEGER NOT NULL DEFAULT 0,
  total_bet       INTEGER NOT NULL DEFAULT 0,
  total_payout    INTEGER NOT NULL DEFAULT 0,
  current_streak  INTEGER NOT NULL DEFAULT 0,
  best_streak     INTEGER NOT NULL DEFAULT 0,
  biggest_win     INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);

CREATE TABLE user_game_stats (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game          TEXT NOT NULL,
  rounds        INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  total_bet     INTEGER NOT NULL DEFAULT 0,
  total_payout  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, game)
);

CREATE TABLE user_achievements (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id  TEXT NOT NULL,
  round_id        TEXT,
  unlocked_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

-- Reclamaciones diarias (bono diario, recarga de demostración): una por día y tipo.
CREATE TABLE daily_claims (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  day         TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, day)
);

-- Bots de demostración: identidades no humanas, claramente marcadas.
CREATE TABLE bots (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  profile       TEXT NOT NULL CHECK (profile IN ('conservative', 'aggressive', 'balanced', 'analytical')),
  difficulty    TEXT NOT NULL DEFAULT 'normal' CHECK (difficulty IN ('easy', 'normal', 'hard')),
  enabled       INTEGER NOT NULL DEFAULT 1,
  bankroll      INTEGER NOT NULL DEFAULT 100000,
  hands_played  INTEGER NOT NULL DEFAULT 0,
  net_result    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE poker_tables (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  small_blind  INTEGER NOT NULL CHECK (small_blind > 0),
  big_blind    INTEGER NOT NULL CHECK (big_blind >= small_blind),
  min_buy_in   INTEGER NOT NULL,
  max_buy_in   INTEGER NOT NULL,
  max_seats    INTEGER NOT NULL DEFAULT 6 CHECK (max_seats BETWEEN 2 AND 9),
  max_bots     INTEGER NOT NULL DEFAULT 4,
  target_players INTEGER NOT NULL DEFAULT 4,
  enabled      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

-- Fichas de jugadores humanos sentados (para reembolsar si el servidor se reinicia).
CREATE TABLE poker_seats (
  table_id   TEXT NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  seat       INTEGER NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stack      INTEGER NOT NULL CHECK (stack >= 0),
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (table_id, seat),
  UNIQUE (table_id, user_id)
);

CREATE TABLE poker_hands (
  id            TEXT PRIMARY KEY,
  table_id      TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT NOT NULL,
  button        INTEGER NOT NULL,
  board_json    TEXT NOT NULL,
  pot           INTEGER NOT NULL,
  players_json  TEXT NOT NULL,
  winners_json  TEXT NOT NULL,
  log_json      TEXT NOT NULL
);
CREATE INDEX idx_poker_hands_table ON poker_hands(table_id, ended_at DESC);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     TEXT,
  action       TEXT NOT NULL,
  target       TEXT,
  details_json TEXT,
  ip           TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE error_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  level         TEXT NOT NULL,
  message       TEXT NOT NULL,
  stack         TEXT,
  context_json  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_errors_created ON error_logs(created_at DESC);
