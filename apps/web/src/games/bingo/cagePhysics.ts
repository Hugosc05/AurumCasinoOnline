/**
 * Física del bombo: bolas dentro de una esfera que gira sobre el eje X.
 *
 * - Gravedad real y rebotes con pérdida de energía contra la jaula y entre bolas.
 * - El rozamiento con los alambres arrastra cada bola hacia la velocidad de la
 *   pared (ω × p): las bolas suben por un lado y caen dando vueltas, como en un
 *   bombo de verdad.
 * - Paso fijo con subpasos: estable aunque el navegador vaya a tirones.
 *
 * Es solo decoración: qué bola sale lo decide el servidor.
 */

export interface CageBall {
  n: number;
  p: [number, number, number];
  v: [number, number, number];
  /** Velocidad angular (para girar la textura del número). */
  w: [number, number, number];
  active: boolean;
}

export const CAGE = {
  radius: 0.5,
  ballR: 0.052,
  gravity: 9.8,
  restitutionWall: 0.38,
  restitutionBall: 0.55,
  /** Rapidez con la que el rozamiento iguala la bola a la pared (1/s). */
  grip: 28,
  drag: 0.08,
  step: 1 / 180,
} as const;

const inner = (): number => CAGE.radius - CAGE.ballR - 0.008;

export function createBalls(numbers: readonly number[], seed = 1): CageBall[] {
  let s = seed >>> 0 || 1;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  const R = inner();
  const out: CageBall[] = [];
  for (const n of numbers) {
    // Montón inicial en la mitad de abajo, sin solaparse demasiado (la física los separa).
    let p: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 40; k += 1) {
      p = [(rnd() * 2 - 1) * R * 0.85, -rnd() * R * 0.85, (rnd() * 2 - 1) * R * 0.85];
      if (Math.hypot(...p) < R && out.every((b) => Math.hypot(b.p[0] - p[0], b.p[1] - p[1], b.p[2] - p[2]) > CAGE.ballR * 1.9)) break;
    }
    out.push({ n, p, v: [0, 0, 0], w: [0, 0, 0], active: true });
  }
  return out;
}

/** Avanza la simulación `dt` segundos con el bombo girando a `omega` rad/s sobre el eje X. */
export function stepCage(balls: CageBall[], dt: number, omega: number, acc = { t: 0 }): void {
  acc.t += Math.min(0.1, dt);
  const h = CAGE.step;
  const R = inner();
  const r2 = CAGE.ballR * 2;
  while (acc.t >= h) {
    acc.t -= h;
    for (const b of balls) {
      if (!b.active) continue;
      b.v[1] -= CAGE.gravity * h;
      const damp = 1 - CAGE.drag * h;
      b.v[0] *= damp;
      b.v[1] *= damp;
      b.v[2] *= damp;
      b.p[0] += b.v[0] * h;
      b.p[1] += b.v[1] * h;
      b.p[2] += b.v[2] * h;
      const d = Math.hypot(b.p[0], b.p[1], b.p[2]);
      if (d > R) {
        const nx = b.p[0] / d;
        const ny = b.p[1] / d;
        const nz = b.p[2] / d;
        b.p[0] = nx * R;
        b.p[1] = ny * R;
        b.p[2] = nz * R;
        const vn = b.v[0] * nx + b.v[1] * ny + b.v[2] * nz;
        if (vn > 0) {
          b.v[0] -= (1 + CAGE.restitutionWall) * vn * nx;
          b.v[1] -= (1 + CAGE.restitutionWall) * vn * ny;
          b.v[2] -= (1 + CAGE.restitutionWall) * vn * nz;
        }
        // Velocidad de la pared en el punto de contacto: ω × p con ω = (omega, 0, 0).
        const wx = 0;
        const wy = -omega * b.p[2];
        const wz = omega * b.p[1];
        const vn2 = b.v[0] * nx + b.v[1] * ny + b.v[2] * nz;
        const tx = b.v[0] - vn2 * nx - wx;
        const ty = b.v[1] - vn2 * ny - wy;
        const tz = b.v[2] - vn2 * nz - wz;
        const k = Math.exp(-CAGE.grip * h);
        b.v[0] = vn2 * nx + wx + tx * k;
        b.v[1] = vn2 * ny + wy + ty * k;
        b.v[2] = vn2 * nz + wz + tz * k;
        // Rodadura: ω_bola = (n × v_rel) / r.
        const rx = b.v[0] - wx;
        const ry = b.v[1] - wy;
        const rz = b.v[2] - wz;
        const ax = (ny * rz - nz * ry) / CAGE.ballR;
        const ay = (nz * rx - nx * rz) / CAGE.ballR;
        const az = (nx * ry - ny * rx) / CAGE.ballR;
        const m = 0.2;
        b.w[0] += (-ax - b.w[0]) * m;
        b.w[1] += (-ay - b.w[1]) * m;
        b.w[2] += (-az - b.w[2]) * m;
      }
    }
    // Choques entre bolas.
    for (let i = 0; i < balls.length; i += 1) {
      const a = balls[i]!;
      if (!a.active) continue;
      for (let j = i + 1; j < balls.length; j += 1) {
        const b = balls[j]!;
        if (!b.active) continue;
        const dx = b.p[0] - a.p[0];
        if (dx > r2 || dx < -r2) continue;
        const dy = b.p[1] - a.p[1];
        if (dy > r2 || dy < -r2) continue;
        const dz = b.p[2] - a.p[2];
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd >= r2 * r2 || dd < 1e-12) continue;
        const d = Math.sqrt(dd);
        const nx = dx / d;
        const ny = dy / d;
        const nz = dz / d;
        const push = (r2 - d) / 2;
        a.p[0] -= nx * push;
        a.p[1] -= ny * push;
        a.p[2] -= nz * push;
        b.p[0] += nx * push;
        b.p[1] += ny * push;
        b.p[2] += nz * push;
        const rv = (b.v[0] - a.v[0]) * nx + (b.v[1] - a.v[1]) * ny + (b.v[2] - a.v[2]) * nz;
        if (rv < 0) {
          const imp = (-(1 + CAGE.restitutionBall) * rv) / 2;
          a.v[0] -= imp * nx;
          a.v[1] -= imp * ny;
          a.v[2] -= imp * nz;
          b.v[0] += imp * nx;
          b.v[1] += imp * ny;
          b.v[2] += imp * nz;
        }
      }
    }
  }
}
