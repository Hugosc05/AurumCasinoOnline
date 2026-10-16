-- v1.3: identidad de los bots y mesas multijugador de blackjack.

-- Bots: perfil visible (avatar original, nivel, estilo de apuestas, estrategia de blackjack).
ALTER TABLE bots ADD COLUMN avatar_json   TEXT NOT NULL DEFAULT '{}';
ALTER TABLE bots ADD COLUMN experience    TEXT NOT NULL DEFAULT 'regular' CHECK (experience IN ('novato', 'regular', 'veterano'));
ALTER TABLE bots ADD COLUMN bet_style     TEXT NOT NULL DEFAULT 'steady' CHECK (bet_style IN ('minimum', 'steady', 'varied'));
ALTER TABLE bots ADD COLUMN bj_strategy   TEXT NOT NULL DEFAULT 'basic' CHECK (bj_strategy IN ('basic', 'cautious', 'bold'));
ALTER TABLE bots ADD COLUMN tagline       TEXT NOT NULL DEFAULT '';
-- Estadísticas reales de blackjack de cada bot (las de póker ya existían).
ALTER TABLE bots ADD COLUMN bj_rounds     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bots ADD COLUMN bj_net        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bots ADD COLUMN poker_wins    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bots ADD COLUMN bj_wins       INTEGER NOT NULL DEFAULT 0;

CREATE TABLE blackjack_tables (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  min_bet         INTEGER NOT NULL CHECK (min_bet > 0),
  max_bet         INTEGER NOT NULL CHECK (max_bet >= min_bet),
  min_buy_in      INTEGER NOT NULL,
  max_buy_in      INTEGER NOT NULL,
  max_seats       INTEGER NOT NULL DEFAULT 5 CHECK (max_seats BETWEEN 1 AND 7),
  max_bots        INTEGER NOT NULL DEFAULT 3,
  target_players  INTEGER NOT NULL DEFAULT 3,
  enabled         INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

-- Las apuestas de los humanos en estas mesas se cargan al monedero como rondas
-- normales de 'blackjack' (game_rounds con clave 'bjt:...'); si el servidor se
-- reinicia con una ronda abierta, se anula y se reembolsa al arrancar.
