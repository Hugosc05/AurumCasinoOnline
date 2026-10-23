-- v1.6: minijuegos de sala (Hold & Win, rueda, caja fuerte) y bote Grand progresivo.

-- Minijuegos pendientes de cada usuario en cada máquina (cola en JSON, con lo no destapado
-- guardado solo aquí, en el servidor).
ALTER TABLE slot_sessions ADD COLUMN feature_json TEXT;

-- Bote Grand compartido por máquina, en milésimas de crédito para acumular aportaciones pequeñas.
CREATE TABLE slot_jackpots (
  machine_id   TEXT PRIMARY KEY,
  grand_milli  INTEGER NOT NULL CHECK (grand_milli >= 0),
  updated_at   TEXT NOT NULL
);
