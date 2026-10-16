/**
 * Periodos diarios en una zona horaria configurable (por defecto Europe/Madrid).
 *
 * Todo se calcula en el servidor: el cliente solo recibe el día vigente y el
 * instante exacto del próximo reinicio, así que cambiar la hora del equipo no
 * adelanta ninguna recompensa.
 */

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(date: Date, tz: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

/** Diferencia (ms) entre la hora local de la zona y UTC en ese instante. */
function offsetMs(date: Date, tz: string): number {
  const p = parts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Clave del día local (AAAA-MM-DD) en la zona indicada. */
export function dayKey(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Instante UTC de la medianoche local que inicia el día `key` (tiene en cuenta los cambios de hora). */
export function startOfDay(key: string, tz: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const localMidnight = Date.UTC(y, m - 1, d);
  let guess = localMidnight - offsetMs(new Date(localMidnight), tz);
  // Dos refinamientos bastan para cruzar un cambio de horario.
  for (let i = 0; i < 2; i += 1) guess = localMidnight - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

/** Clave del día local anterior o posterior. */
export function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Periodo vigente y próximo reinicio. */
export function periodInfo(now: Date, tz: string): { day: string; nextResetAt: string; msUntilReset: number } {
  const day = dayKey(now, tz);
  const next = startOfDay(shiftDay(day, 1), tz);
  return { day, nextResetAt: next.toISOString(), msUntilReset: Math.max(0, next.getTime() - now.getTime()) };
}
