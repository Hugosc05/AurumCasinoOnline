import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, migrate, nowIso } from '../src/db/database';
import { ImportError, importFromFile, importFromPostgres, parseCsv } from '../src/db/importer';
import { verifyLedger } from '../src/wallet/wallet';

/**
 * El importador contra un PostgreSQL real (PGlite). Caso que motivó la prueba:
 * Supabase se quedó en la versión 10 del esquema (Render ya no arrancó la 11)
 * y el código del servidor de casa ya va por la 11.
 */
describe('importar desde PostgreSQL', () => {
  let dir: string;
  let srcUrl: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'aurum-import-'));
    srcUrl = `pglite:${path.join(dir, 'pg')}`;
    const src = new Database(srcUrl);
    migrate(src, 10);
    const now = nowIso();
    src.run(`INSERT INTO users (id, username, email, password_hash, role, balance, created_at) VALUES ('u1', 'Lucia', 'lucia@example.com', 'x', 'player', 10500, ?)`, now);
    src.run(`INSERT INTO wallet_transactions (user_id, amount, balance_before, balance_after, reason, unlimited, created_at) VALUES ('u1', 10000, 0, 10000, 'signup_bonus', 0, ?)`, now);
    src.run(`INSERT INTO wallet_transactions (user_id, amount, balance_before, balance_after, reason, unlimited, created_at) VALUES ('u1', 500, 10000, 10500, 'daily_bonus', 0, ?)`, now);
    src.run(`INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES ('h1', 'u1', ?, ?, ?, '1.2.3.4', 'ua')`, now, now, now);
    src.run(`INSERT INTO user_profiles (user_id, card_back, updated_at) VALUES ('u1', 'back:oro', ?)`, now);
    src.close();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('copia una base en una versión anterior y la actualiza después', () => {
    const target = path.join(dir, 'a.db');
    const lines: string[] = [];
    const r = importFromPostgres(srcUrl, target, { log: (l) => lines.push(l) });
    expect(r.sourceVersion).toBe(10);
    expect(r.finalVersion).toBeGreaterThan(10);
    expect(r.upgraded).toContain('011_admin_insights.sql');
    expect(r.users).toBe(1);
    expect(lines.join('\n')).toContain('versión 10');

    const db = new Database(target);
    expect(db.get('SELECT username, balance FROM users')).toEqual({ username: 'Lucia', balance: 10500 });
    expect(verifyLedger(db, 'u1').ok).toBe(true);
    // Lo que añadió la migración 11 existe y la sesión copiada sigue valiendo.
    expect(db.get('SELECT mfa_at, ip FROM sessions')).toEqual({ mfa_at: null, ip: '1.2.3.4' });
    expect(db.get('SELECT COUNT(*) AS n FROM security_events')).toEqual({ n: 0 });
    expect(db.get<{ card_back: string }>('SELECT card_back FROM user_profiles')!.card_back).toBe('back:oro');
    // Y no hay migraciones pendientes.
    expect(migrate(db)).toEqual([]);
    db.close();
  });

  it('no sobrescribe un destino con cuentas salvo con --force; uno vacío se reemplaza', () => {
    const target = path.join(dir, 'b.db');
    importFromPostgres(srcUrl, target);
    expect(() => importFromPostgres(srcUrl, target)).toThrow(/ya tiene 1 cuentas/);
    expect(importFromPostgres(srcUrl, target, { force: true }).users).toBe(1);

    // Un intento anterior dejó una base vacía ya en la versión nueva: se rehace sin pedir --force.
    const empty = path.join(dir, 'c.db');
    const e = new Database(empty);
    migrate(e);
    e.close();
    expect(importFromPostgres(srcUrl, empty).users).toBe(1);
    const raw = new DatabaseSync(empty);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(1);
    raw.close();
  });

  it('rechaza un origen más nuevo que el código', () => {
    const src = new Database(srcUrl);
    src.run(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, '099_futuro.sql', ?)`, nowIso());
    src.close();
    try {
      expect(() => importFromPostgres(srcUrl, path.join(dir, 'd.db'))).toThrow(ImportError);
      expect(() => importFromPostgres(srcUrl, path.join(dir, 'd.db'))).toThrow(/versión 99/);
    } finally {
      const s = new Database(srcUrl);
      s.run('DELETE FROM schema_migrations WHERE version = 99');
      s.close();
    }
  });

  it('importa el CSV que descarga el SQL Editor de Supabase con deploy/supabase-export.sql', () => {
    // La consulta del repositorio, ejecutada tal cual contra PostgreSQL.
    const sql = readFileSync(path.join(__dirname, '../../../deploy/supabase-export.sql'), 'utf8');
    const createFn = sql.slice(sql.indexOf('create or replace function'), sql.indexOf('select * from pg_temp.aurum_export()'));
    const src = new Database(srcUrl);
    src.exec(createFn);
    const rows = src.all<{ tabla: string; datos: string }>('select * from pg_temp.aurum_export()');
    src.close();
    expect(rows.map((r) => r.tabla)).toEqual(expect.arrayContaining(['users', 'wallet_transactions', 'schema_migrations']));
    // CSV como el de Supabase: cabecera, comillas dobles escapadas y fin de línea CRLF.
    const q = (v: string): string => `"${v.replace(/"/g, '""')}"`;
    const csv = ['tabla,datos', ...rows.map((r) => `${r.tabla},${q(r.datos)}`)].join('\r\n') + '\r\n';
    const file = path.join(dir, 'supabase-export.csv');
    writeFileSync(file, `﻿${csv}`);

    const target = path.join(dir, 'desde-archivo.db');
    const r = importFromFile(file, target);
    expect(r).toMatchObject({ users: 1, sourceVersion: 10 });
    expect(r.finalVersion).toBeGreaterThan(10);
    const db = new Database(target);
    expect(db.get('SELECT username, email, balance FROM users')).toEqual({ username: 'Lucia', email: 'lucia@example.com', balance: 10500 });
    expect(verifyLedger(db, 'u1').ok).toBe(true);
    expect(db.get<{ card_back: string }>('SELECT card_back FROM user_profiles')!.card_back).toBe('back:oro');
    db.close();

    // También vale el mismo contenido en JSON.
    const json = path.join(dir, 'export.json');
    writeFileSync(json, JSON.stringify(rows));
    expect(importFromFile(json, path.join(dir, 'desde-json.db')).users).toBe(1);
  });

  it('rechaza archivos que no son una exportación de Aurum', () => {
    const bad = path.join(dir, 'malo.csv');
    writeFileSync(bad, 'nombre,email\nAna,a@b.c\n');
    expect(() => importFromFile(bad, path.join(dir, 'x.db'))).toThrow(/columnas «tabla» y «datos»/);
    const partial = path.join(dir, 'parcial.csv');
    writeFileSync(partial, 'tabla,datos\nusers,"[]"\n');
    expect(() => importFromFile(partial, path.join(dir, 'y.db'))).toThrow(/schema_migrations/);
    expect(() => importFromFile(path.join(dir, 'no-existe.csv'), path.join(dir, 'z.db'))).toThrow(/No encuentro/);
  });

  it('lee CSV con comillas, comas y saltos de línea dentro de los campos', () => {
    expect(parseCsv('a,b\r\n"x, y","línea 1\nlínea 2 con ""comillas"""\r\n')).toEqual([['a', 'b'], ['x, y', 'línea 1\nlínea 2 con "comillas"']]);
  });
});
