/**
 * Trayectoria de la ruleta (función pura, comprobable con pruebas).
 *
 * El número ganador lo decide el servidor ANTES de girar. Esta función
 * construye una trayectoria física creíble que termina exactamente en ese
 * bolsillo:
 *
 *   rueda   W(t) = W0 + ω0·τ·(1 − e^(−t/τ))           (horario, frenando)
 *   bola    B(t) = W(t) + φ(t)                         (antihorario respecto a la rueda)
 *   φ(t)    = φEnd + Φ·(1 − u)^k  + rebotes amortiguados que se anulan en u = 1
 *
 * con u = t / tSeat. En tSeat la bola queda asentada (φ = φEnd) y a partir
 * de ahí gira solidaria con la rueda, que sigue frenando hasta pararse.
 */

export const POCKETS = 37;
export const POCKET_DEG = 360 / POCKETS;

export interface SpinPlanInput {
  /** Índice del bolsillo ganador en el orden de la rueda (0..36). */
  pocketIndex: number;
  /** Ángulo actual de la rueda (grados). */
  wheelAngle: number;
  /** Ángulo actual de la bola relativo a la rueda (grados). */
  ballRelAngle: number;
  /** Duración total (ms). */
  duration: number;
  /** Rebotes visibles (false en movimiento reducido). */
  bounces: boolean;
  /** Variación pseudoaleatoria visual (0..1) para que no todos los giros sean idénticos. */
  variation?: number;
}

export interface SpinFrame {
  wheel: number;
  ball: number; // absoluto
  ballRel: number;
  /** Radio normalizado: 1 = borde exterior (pista), 0 = bolsillo. */
  radius: number;
  /** Velocidad relativa normalizada (para sonido). */
  speed: number;
  phase: 'rim' | 'drop' | 'seated';
}

export interface SpinPlan {
  duration: number;
  frame(tMs: number): SpinFrame;
  final: SpinFrame;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

export function pocketCenterDeg(index: number): number {
  return index * POCKET_DEG;
}

export function planSpin(input: SpinPlanInput): SpinPlan {
  const T = Math.max(1, input.duration) / 1000;
  const v = input.variation ?? 0.5;
  const tSeat = T * 0.8;
  const tDrop = tSeat * (0.6 + v * 0.06);
  const tau = T * 0.42;
  const omega0 = 115 + v * 25; // grados/s de la rueda
  const k = 2.3;

  const phiEnd = pocketCenterDeg(input.pocketIndex);
  // Velocidad relativa inicial deseada ≈ 700°/s → Φ ≈ 700·tSeat/k, ajustado para terminar en φEnd.
  const target = (700 + v * 120) * (tSeat / k);
  const base = mod(input.ballRelAngle - phiEnd, 360);
  const Phi = base + 360 * Math.max(1, Math.round((target - base) / 360));

  const wheelAt = (t: number): number => input.wheelAngle + omega0 * tau * (1 - Math.exp(-t / tau));
  const bounceAmp = input.bounces ? 1 : 0;

  const frame = (tMs: number): SpinFrame => {
    const t = Math.min(Math.max(tMs / 1000, 0), T);
    const wheel = wheelAt(t);
    if (t >= tSeat) {
      const s = (t - tSeat) / Math.max(0.001, T - tSeat);
      // Pequeño asentamiento dentro del bolsillo que se extingue.
      const wobble = bounceAmp * 1.6 * (1 - s) ** 2 * Math.sin(s * Math.PI * 3);
      const rel = phiEnd + wobble;
      return { wheel, ball: wheel + rel, ballRel: rel, radius: 0, speed: 0, phase: 'seated' };
    }
    const u = t / tSeat;
    let rel = phiEnd + Phi * (1 - u) ** k;
    let radius = 1;
    let phase: SpinFrame['phase'] = 'rim';
    if (t > tDrop) {
      phase = 'drop';
      const d = (t - tDrop) / (tSeat - tDrop); // 0..1
      const fall = 1 - (1 - d) ** 1.6;
      const bounce = bounceAmp * 0.22 * (1 - d) ** 1.4 * Math.abs(Math.sin(d * Math.PI * 4.5));
      radius = Math.max(0, 1 - fall + bounce);
      rel += bounceAmp * 7 * (1 - d) ** 2 * Math.sin(d * Math.PI * 6);
    }
    const speed = (k * Phi * (1 - u) ** (k - 1)) / tSeat / 900;
    return { wheel, ball: wheel + rel, ballRel: rel, radius, speed: Math.min(1, speed), phase };
  };

  return { duration: T * 1000, frame, final: frame(T * 1000) };
}
