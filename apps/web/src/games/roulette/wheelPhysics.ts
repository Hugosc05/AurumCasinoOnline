/**
 * Física de la ruleta (función pura, sin dependencias de dibujo).
 *
 * El servidor decide el número ANTES de lanzar la bola. Aquí se simula una
 * tirada físicamente plausible de principio a fin y después se garantiza que
 * termina en ese bolsillo sin "teletransportes":
 *
 *  1. Pista: la bola gira pegada a la pared inclinada del cuenco y pierde
 *     velocidad por rozamiento de rodadura y del aire.
 *  2. Cono: por debajo de la velocidad crítica cae por la pendiente; puede
 *     chocar con los 8 rombos (deflectores) y saltar.
 *  3. Rotor: entra en la corona giratoria, rebota contra los separadores
 *     metálicos entre bolsillos (o salta por encima) hasta que se queda
 *     atrapada en uno.
 *
 * Por qué el resultado es exacto: los 37 bolsillos son idénticos, así que si
 * el rotor estuviera girado k bolsillos más, la bola haría exactamente el mismo
 * recorrido y caería k bolsillos más allá (simetría de rotación). Mientras la
 * bola está en la pista no toca el rotor, de modo que en esos primeros segundos
 * se corrige con suavidad la fase del rotor (unos grados de más o de menos en
 * su giro) hasta que el bolsillo bajo la bola sea el decidido. Se prueban
 * varias semillas y se elige la que necesita la menor corrección.
 */

export const POCKETS = 37;
export const POCKET_RAD = (2 * Math.PI) / POCKETS;
const TAU = Math.PI * 2;
const G = 9.81;

/** Geometría (metros): una ruleta de casino mide unos 80 cm de diámetro. */
export const GEO = {
  trackR: 0.405, // centro de la bola sobre la pista
  trackH: 0.062, // altura de la pista respecto a la base del rotor
  rotorR: 0.335, // borde del rotor (fin del cono fijo)
  rotorH: 0.03,
  deflectorR: 0.37,
  deflectors: 8,
  deflectorHalfAngle: 0.07,
  pocketOutR: 0.3,
  pocketInR: 0.232,
  seatR: 0.266,
  seatH: 0.006,
  fretH: 0.013,
  ballR: 0.0095,
} as const;

/** Altura de la superficie bajo la bola en función del radio. */
export function surfaceHeight(r: number): number {
  if (r >= GEO.trackR) return GEO.trackH;
  if (r >= GEO.rotorR) return GEO.rotorH + ((r - GEO.rotorR) / (GEO.trackR - GEO.rotorR)) * (GEO.trackH - GEO.rotorH);
  if (r >= GEO.pocketOutR) return GEO.seatH + ((r - GEO.pocketOutR) / (GEO.rotorR - GEO.pocketOutR)) * (GEO.rotorH - GEO.seatH);
  return GEO.seatH;
}

export function deflectorAngle(i: number): number {
  return (i + 0.5) * (TAU / GEO.deflectors);
}

/** Un fotograma de la animación. Ángulos absolutos en radianes (positivo = sentido de la bola). */
export interface WheelFrame {
  t: number;
  /** Ángulo del rotor. */
  wheel: number;
  /** Ángulo de la bola. */
  ball: number;
  /** Radio de la bola. */
  r: number;
  /** Altura del centro de la bola sobre la base. */
  y: number;
  /** Velocidad lineal de la bola respecto a lo que pisa (para el sonido y el giro de la bola). */
  speed: number;
  phase: 'track' | 'cone' | 'rotor' | 'seated';
}

export type WheelEvent =
  | { t: number; kind: 'drop' } // deja la pista
  | { t: number; kind: 'deflector'; strength: number }
  | { t: number; kind: 'fret'; strength: number }
  | { t: number; kind: 'seat' };

export interface WheelRun {
  frames: WheelFrame[];
  events: WheelEvent[];
  /** Instante en que la bola queda asentada. */
  seatedAt: number;
  duration: number;
  /** Bolsillo final (índice en el orden de la rueda). */
  pocket: number;
  /** Corrección de fase aplicada al rotor (radianes). */
  correction: number;
}

export interface SpinInput {
  /** Bolsillo decidido por el servidor (índice 0..36 en el orden de la rueda). */
  pocket: number;
  /** Ángulo actual del rotor (para continuar sin saltos). */
  wheelAngle: number;
  /** Velocidad actual del rotor (rad/s, negativa = sentido contrario a la bola). */
  wheelSpeed?: number;
  /** Semilla de la variación visual (no influye en el resultado). */
  seed?: number;
  /** Tirada corta (movimiento reducido): menos vueltas y menos rebotes. */
  short?: boolean;
  /** Segundos tras asentarse durante los que se sigue mostrando el rotor girando. */
  tail?: number;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Generador pseudoaleatorio reproducible (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bolsillo bajo un ángulo relativo al rotor. */
export function pocketAt(relAngle: number): number {
  return Math.round(mod(relAngle, TAU) / POCKET_RAD) % POCKETS;
}

interface Sim {
  frames: WheelFrame[];
  events: WheelEvent[];
  seatedAt: number;
  rotorEntry: number;
  /** Ángulo relativo final de la bola respecto al rotor (sin corrección). */
  finalRel: number;
}

const DT = 1 / 600;
const SAMPLE = 1 / 120;

/** Perfil de velocidad del rotor: impulso del crupier y frenado muy lento. */
function rotorSpeedAt(t: number, w0: number, wTarget: number): number {
  const ramp = 1 - Math.exp(-t / 0.35);
  return (w0 + (wTarget - w0) * ramp) * Math.exp(-t / 38);
}

function simulate(input: SpinInput, seed: number, correction: number, corrEnd: number): Sim {
  const rand = rng(seed);
  const short = input.short ?? false;
  const w0 = input.wheelSpeed ?? -0.4;
  const wTarget = -(2.2 + rand() * 0.8);
  // Velocidad inicial de la bola (rad/s): 3–4 vueltas por segundo en una tirada normal.
  let omega = short ? 13 + rand() * 2 : 22 + rand() * 4;
  const omegaCrit = 6.6 + rand() * 0.5;
  const rollA = 0.85 + rand() * 0.15;
  const dragB = 0.011 + rand() * 0.003;

  let t = 0;
  let wheel = input.wheelAngle;
  let theta = rand() * TAU; // posición de lanzamiento
  let r: number = GEO.trackR;
  let vr = 0;
  let z = 0; // altura de salto sobre la superficie
  let vz = 0;
  let phase: WheelFrame['phase'] = 'track';
  let rel = 0;
  let omegaRel = 0;
  let seatedAt = -1;
  let rotorEntry = -1;
  let seatFrom = 0;
  let seatTarget = 0;
  let lastDeflect = -1;
  let lastFret = Number.NaN;
  const frames: WheelFrame[] = [];
  const events: WheelEvent[] = [];
  let nextSample = 0;
  const tail = input.tail ?? 2.2;
  const tMax = short ? 9 : 16;

  // Corrección de fase del rotor: rampa suave (0 → correction) que acaba antes de que la bola llegue al rotor.
  const corrAt = (tt: number): number => {
    if (correction === 0) return 0;
    const u = Math.min(1, tt / corrEnd);
    return correction * (u * u * (3 - 2 * u));
  };
  let wheelBase = input.wheelAngle;

  for (;;) {
    const ws = rotorSpeedAt(t, w0, wTarget);
    wheelBase += ws * DT;
    wheel = wheelBase + corrAt(t + DT);

    if (phase === 'track') {
      omega -= (rollA + dragB * omega * omega) * DT;
      theta += omega * DT;
      if (omega <= omegaCrit) {
        phase = 'cone';
        vr = -0.02;
        events.push({ t, kind: 'drop' });
      }
    } else if (phase === 'cone') {
      // Bola sobre un cono inclinado: centrífuga contra gravedad; conserva (casi) el momento angular.
      // Por debajo de la velocidad crítica la pared ya no la sostiene: la gravedad la lleva hacia
      // dentro por la pendiente, y lo que queda de fuerza centrífuga solo frena la caída.
      const airborne = z > 0.0005;
      const ar = airborne ? r * omega * omega * 0.1 : r * omega * omega * 0.1 - G * 0.42;
      vr += ar * DT;
      vr *= airborne ? 1 : 1 - 1.2 * DT;
      const rNew = Math.min(GEO.trackR, r + vr * DT);
      omega = (omega * r * r) / (rNew * rNew) - (airborne ? 0.15 : 0.55) * DT * Math.sign(omega);
      r = rNew;
      theta += omega * DT;
      // Rombos.
      if (!airborne && Math.abs(r - GEO.deflectorR) < 0.013 && t - lastDeflect > 0.12) {
        for (let i = 0; i < GEO.deflectors; i += 1) {
          const d = Math.abs(mod(theta - deflectorAngle(i) + Math.PI, TAU) - Math.PI);
          if (d < GEO.deflectorHalfAngle) {
            const strength = Math.min(1, (Math.abs(omega) * r) / 3);
            omega *= 0.45 + rand() * 0.3;
            vr = (rand() < 0.35 ? 0.15 : -0.05) * (0.5 + rand());
            vz = Math.min(0.75, (0.3 + rand() * 0.45) * strength + 0.12);
            z = 0.001;
            lastDeflect = t;
            events.push({ t, kind: 'deflector', strength });
            break;
          }
        }
      }
      if (r >= GEO.trackR && vr > 0) vr = -Math.abs(vr) * 0.3;
      if (r <= GEO.rotorR) {
        phase = 'rotor';
        rotorEntry = t;
        rel = theta - wheel;
        omegaRel = omega - ws;
      }
    } else if (phase === 'rotor') {
      const airborne = z > 0.0005;
      // La bola baja por la corona hacia los bolsillos.
      const target = GEO.seatR;
      const ar = -(airborne ? 4 : 26) * (r - target) - (airborne ? 0.5 : 5.5) * vr;
      vr += ar * DT;
      r += vr * DT;
      r = Math.min(Math.max(r, GEO.pocketInR + GEO.ballR), GEO.rotorR);
      // Rozamiento relativo (más fuerte rodando dentro de un bolsillo).
      const inPockets = r < GEO.pocketOutR;
      const fr = airborne ? 0.12 : inPockets ? 0.9 : 0.5;
      const prevRel = rel;
      omegaRel -= Math.sign(omegaRel) * Math.min(Math.abs(omegaRel), fr * DT);
      rel += omegaRel * DT;
      // Separadores: cruzar el borde entre dos bolsillos (a medio bolsillo de cada centro).
      if (inPockets && z < GEO.fretH) {
        const cellPrev = Math.floor(prevRel / POCKET_RAD + 0.5);
        const cellNow = Math.floor(rel / POCKET_RAD + 0.5);
        if (cellPrev !== cellNow && cellNow !== lastFret) {
          const v = Math.abs(omegaRel) * r;
          const strength = Math.min(1, v / 1.2);
          if (v > 0.35 && rand() < 0.5 + 0.4 * strength) {
            // Salta por encima del separador.
            vz = Math.min(0.62, 0.12 + v * (0.12 + rand() * 0.1));
            z = Math.max(z, 0.001);
            omegaRel *= 0.78 + rand() * 0.14;
            vr += (rand() - 0.5) * 0.25;
          } else {
            // Choca y rebota hacia atrás.
            const edge = (cellPrev + (cellNow > cellPrev ? 0.5 : -0.5)) * POCKET_RAD;
            rel = edge - Math.sign(omegaRel) * 0.002;
            omegaRel = -omegaRel * (0.3 + rand() * 0.3);
            vz = v * (0.08 + rand() * 0.1);
            z = Math.max(z, vz > 0.02 ? 0.001 : 0);
            lastFret = cellPrev;
          }
          events.push({ t, kind: 'fret', strength });
          if (lastFret !== cellPrev) lastFret = Number.NaN;
        }
      }
      theta = wheel + rel;
      const vRel = Math.abs(omegaRel) * r;
      if ((inPockets && !airborne && vRel < 0.035 && Math.abs(vr) < 0.05) || t > tMax) {
        phase = 'seated';
        seatedAt = t;
        seatFrom = rel;
        seatTarget = Math.round(rel / POCKET_RAD) * POCKET_RAD;
        events.push({ t, kind: 'seat' });
      }
    } else {
      // Asentada: se centra en el bolsillo con un pequeño balanceo amortiguado.
      const s = t - seatedAt;
      rel = seatTarget + (seatFrom - seatTarget) * Math.exp(-s * 7) * Math.cos(s * 22);
      r += (GEO.seatR - r) * Math.min(1, DT * 10);
      theta = wheel + rel;
      if (s >= tail) break;
    }

    // Saltos verticales.
    if (z > 0 || vz > 0) {
      vz -= G * DT;
      z += vz * DT;
      if (z <= 0) {
        z = 0;
        vz = Math.abs(vz) > 0.15 ? -vz * 0.32 : 0;
        if (vz > 0) z = 0.0005;
      }
    }

    t += DT;
    if (t >= nextSample) {
      const speed = phase === 'track' || phase === 'cone' ? Math.abs(omega) * r : phase === 'rotor' ? Math.abs(omegaRel) * r : 0;
      frames.push({ t, wheel, ball: theta, r, y: surfaceHeight(r) + GEO.ballR + z, speed, phase });
      nextSample += SAMPLE;
    }
  }
  return { frames, events, seatedAt, rotorEntry, finalRel: seatTarget };
}

/**
 * Planifica una tirada completa que termina en `input.pocket`.
 * Determinista para una misma entrada (la semilla solo cambia el aspecto).
 */
export function planWheelSpin(input: SpinInput): WheelRun {
  const baseSeed = (input.seed ?? 1) >>> 0;
  const candidates: { seed: number; correction: number; corrEnd: number }[] = [];
  for (let k = 0; k < 12; k += 1) {
    const seed = (baseSeed + k * 7919) >>> 0;
    const free = simulate(input, seed, 0, 1);
    const landed = pocketAt(free.finalRel);
    // Girar el rotor +Δ hace caer la bola Δ bolsillos "antes": la corrección es (caído − deseado),
    // reducida a la equivalente más pequeña (entre −medio giro y +medio giro).
    let correction = mod((landed - input.pocket) * POCKET_RAD + Math.PI, TAU) - Math.PI;
    if (Math.abs(correction) < 1e-9) correction = 0;
    const corrEnd = Math.max(0.6, Math.min(3.5, free.rotorEntry * 0.7));
    candidates.push({ seed, correction, corrEnd });
  }
  candidates.sort((a, b) => Math.abs(a.correction) - Math.abs(b.correction));
  for (const c of candidates) {
    const sim = simulate(input, c.seed, c.correction, c.corrEnd);
    const last = sim.frames[sim.frames.length - 1]!;
    const pocket = pocketAt(last.ball - last.wheel);
    // Comprobación final: con aritmética de coma flotante, en un caso límite una trayectoria podría
    // divergir; entonces se usa la siguiente semilla.
    if (pocket === input.pocket) {
      return { frames: sim.frames, events: sim.events, seatedAt: sim.seatedAt, duration: last.t, pocket, correction: c.correction };
    }
  }
  throw new Error('No se pudo planificar la tirada');
}

/** Fotograma interpolado en el instante t (segundos). */
export function frameAt(run: WheelRun, t: number): WheelFrame {
  const f = run.frames;
  if (t <= f[0]!.t) return f[0]!;
  if (t >= run.duration) return f[f.length - 1]!;
  const i = Math.min(f.length - 2, Math.floor(t / SAMPLE));
  let a = f[i]!;
  let b = f[i + 1]!;
  if (t < a.t && i > 0) {
    b = a;
    a = f[i - 1]!;
  }
  const u = Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-6, b.t - a.t)));
  const lerp = (x: number, y: number): number => x + (y - x) * u;
  return { t, wheel: lerp(a.wheel, b.wheel), ball: lerp(a.ball, b.ball), r: lerp(a.r, b.r), y: lerp(a.y, b.y), speed: lerp(a.speed, b.speed), phase: u < 0.5 ? a.phase : b.phase };
}
