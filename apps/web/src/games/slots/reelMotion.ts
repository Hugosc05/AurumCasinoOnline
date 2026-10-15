/**
 * Física de un rodillo mecánico (función pura, sin DOM).
 *
 * `pos` es la posición del rodillo en unidades de símbolo: el símbolo de la
 * fila superior de la ventana es `strip[floor(pos mod L)]`. Los símbolos caen
 * (como en una máquina real), así que durante el giro `pos` decrece.
 *
 * Fases:
 *   idle → windup (pequeño retroceso hacia arriba, como al soltar la palanca)
 *        → accel (aceleración constante) → cruise (velocidad máxima, sin límite
 *        de tiempo: el rodillo gira mientras llega la respuesta del servidor)
 *        → brake (deceleración constante hasta pasar ligeramente la parada)
 *        → settle (rebote de vuelta a la parada exacta) → idle.
 *
 * Al empezar a frenar, el rodillo salta a la posición desde la que la frenada
 * termina exactamente en la parada del servidor. El salto es de un número
 * entero de símbolos y se hace a velocidad máxima (con desenfoque), así que es
 * imperceptible; la ventana final siempre es la decidida por el servidor.
 */

export interface ReelConfig {
  /** Velocidad de crucero (símbolos por segundo). */
  vmax: number;
  /** Retroceso inicial (símbolos) y su duración (ms). */
  windup: number;
  windupMs: number;
  /** Tiempo hasta la velocidad máxima (ms). */
  accelMs: number;
  /** Duración aproximada de la frenada normal y de la rápida (ms). */
  brakeMs: number;
  slamBrakeMs: number;
  /** Cuánto se pasa de la parada antes de rebotar (símbolos) y duración del rebote (ms). */
  overshoot: number;
  settleMs: number;
}

export const REEL_FULL: ReelConfig = { vmax: 24, windup: 0.22, windupMs: 120, accelMs: 300, brakeMs: 520, slamBrakeMs: 260, overshoot: 0.24, settleMs: 260 };
export const REEL_REDUCED: ReelConfig = { vmax: 14, windup: 0, windupMs: 0, accelMs: 160, brakeMs: 320, slamBrakeMs: 200, overshoot: 0, settleMs: 0 };

export type ReelPhase = 'idle' | 'windup' | 'accel' | 'cruise' | 'brake' | 'settle';

export interface ReelState {
  readonly L: number;
  phase: ReelPhase;
  /** Posición sin envolver al inicio de la fase actual. */
  p0: number;
  /** Instante (ms) de inicio de la fase actual. */
  t0: number;
  /** Duración de la fase actual (ms; Infinity en crucero). */
  dur: number;
  /** Para la frenada: distancia total a recorrer (símbolos). */
  dist: number;
  /** Parada final (si ya se conoce). */
  target: number | null;
  /** Instante en que debe empezar a frenar (si ya se conoce). */
  stopAt: number | null;
  slam: boolean;
  /** Última posición calculada (sin envolver) y velocidad (símbolos/s, positiva = los símbolos caen). */
  pos: number;
  vel: number;
  cfg: ReelConfig;
}

export const mod = (v: number, L: number): number => ((v % L) + L) % L;

export function createReel(L: number, stop: number, cfg: ReelConfig = REEL_FULL): ReelState {
  return { L, phase: 'idle', p0: stop, t0: 0, dur: 0, dist: 0, target: null, stopAt: null, slam: false, pos: stop, vel: 0, cfg };
}

/** Empieza a girar en `now + delayMs`. */
export function startSpin(s: ReelState, now: number, delayMs = 0, cfg: ReelConfig = s.cfg): void {
  s.cfg = cfg;
  s.target = null;
  s.stopAt = null;
  s.slam = false;
  s.p0 = mod(s.pos, s.L);
  s.pos = s.p0;
  s.vel = 0;
  if (cfg.windupMs > 0) {
    s.phase = 'windup';
    s.t0 = now + delayMs;
    s.dur = cfg.windupMs;
  } else {
    s.phase = 'accel';
    s.t0 = now + delayMs;
    s.dur = cfg.accelMs;
  }
}

/** Indica la parada del servidor y cuándo debe empezar a frenar como pronto. */
export function requestStop(s: ReelState, target: number, at: number, slam = false): void {
  s.target = mod(target, s.L);
  s.stopAt = at;
  s.slam = slam;
}

/** Fuerza una parada rápida (pulsar de nuevo durante el giro). Solo si ya se conoce la parada. */
export function slamStop(s: ReelState, now: number, delayMs = 0): void {
  if (s.target === null) return;
  if (s.phase === 'brake' || s.phase === 'settle' || s.phase === 'idle') return;
  s.stopAt = Math.min(s.stopAt ?? Infinity, now + delayMs);
  s.slam = true;
}

/** Coloca el rodillo directamente en una parada (sin animación). */
export function snapTo(s: ReelState, stop: number): void {
  s.phase = 'idle';
  s.pos = mod(stop, s.L);
  s.p0 = s.pos;
  s.vel = 0;
  s.target = null;
  s.stopAt = null;
}

function beginBrake(s: ReelState, now: number): void {
  const cfg = s.cfg;
  const v = s.vel > 0.01 ? s.vel : cfg.vmax;
  const target = s.target!;
  const brakeMs = s.slam ? cfg.slamBrakeMs : cfg.brakeMs;
  // Con deceleración constante: distancia = v · T / 2.
  const ideal = (v * brakeMs) / 2000;
  const frac = s.pos - Math.floor(s.pos);
  const whole = Math.max(1, Math.round(ideal - frac - cfg.overshoot));
  // Salto entero: misma fracción visible, otros símbolos (imperceptible a esta velocidad).
  const start = target + whole + frac;
  const dist = start - (target - cfg.overshoot);
  s.phase = 'brake';
  s.p0 = start;
  s.pos = start;
  s.t0 = now;
  s.dist = dist;
  s.dur = (2 * dist * 1000) / v;
}

/**
 * Avanza el estado hasta `now`. Devuelve `true` en el instante en que el rodillo
 * se detiene definitivamente (para el sonido y la notificación de parada).
 * Se pueden encadenar varias fases en una sola llamada si el fotograma es largo.
 */
export function step(s: ReelState, now: number): { stopped: boolean; landed: boolean } {
  let stopped = false;
  let landed = false;
  for (let guard = 0; guard < 8; guard += 1) {
    const cfg = s.cfg;
    const t = now - s.t0;
    if (s.phase === 'idle') {
      s.vel = 0;
      break;
    }
    if (t < 0) {
      // Retardo de arranque: el rodillo sigue quieto.
      s.pos = s.p0;
      s.vel = 0;
      break;
    }
    if (s.phase === 'windup') {
      if (t < s.dur) {
        const u = t / s.dur;
        s.pos = s.p0 + cfg.windup * Math.sin((u * Math.PI) / 2);
        s.vel = -cfg.windup * (Math.PI / 2) * Math.cos((u * Math.PI) / 2) * (1000 / s.dur);
        break;
      }
      s.phase = 'accel';
      s.p0 = s.p0 + cfg.windup;
      s.t0 += s.dur;
      s.dur = cfg.accelMs;
      continue;
    }
    if (s.phase === 'accel') {
      const a = cfg.vmax / Math.max(1, s.dur); // símbolos/s por ms
      if (t < s.dur) {
        s.pos = s.p0 - (0.5 * a * t * t) / 1000;
        s.vel = a * t;
        break;
      }
      s.phase = 'cruise';
      s.p0 = s.p0 - (0.5 * a * s.dur * s.dur) / 1000;
      s.t0 += s.dur;
      s.dur = Infinity;
      continue;
    }
    if (s.phase === 'cruise') {
      const v = cfg.vmax;
      if (s.target !== null && s.stopAt !== null && now >= s.stopAt) {
        const at = Math.max(s.t0, s.stopAt);
        s.pos = s.p0 - (v * (at - s.t0)) / 1000;
        s.vel = v;
        beginBrake(s, at);
        continue;
      }
      s.pos = s.p0 - (v * t) / 1000;
      s.vel = v;
      break;
    }
    if (s.phase === 'brake') {
      if (t < s.dur) {
        const u = t / s.dur;
        // Deceleración constante: f(u) = 2u − u², velocidad inicial = v, final = 0.
        s.pos = s.p0 - s.dist * (2 * u - u * u);
        s.vel = ((2 * s.dist * (1 - u)) / s.dur) * 1000;
        break;
      }
      landed = true;
      const end = s.target! - cfg.overshoot;
      if (cfg.settleMs > 0 && cfg.overshoot > 0) {
        s.phase = 'settle';
        s.p0 = end;
        s.t0 += s.dur;
        s.dur = cfg.settleMs;
        continue;
      }
      snapTo(s, s.target!);
      stopped = true;
      break;
    }
    if (s.phase === 'settle') {
      if (t < s.dur) {
        const u = t / s.dur;
        // Rebote amortiguado hacia la parada (vuelve hacia arriba con un pequeño exceso).
        const e = 1 - Math.cos(u * Math.PI * 0.5);
        const wobble = Math.sin(u * Math.PI) * 0.18 * (1 - u);
        s.pos = s.p0 + s.cfg.overshoot * (e + wobble);
        s.vel = 0;
        break;
      }
      snapTo(s, s.target!);
      stopped = true;
      break;
    }
  }
  return { stopped, landed };
}

/** Desenfoque de movimiento recomendado (0, 1 o 2) según la velocidad. */
export function blurLevel(s: ReelState): 0 | 1 | 2 {
  const r = Math.abs(s.vel) / s.cfg.vmax;
  return r > 0.75 ? 2 : r > 0.35 ? 1 : 0;
}
