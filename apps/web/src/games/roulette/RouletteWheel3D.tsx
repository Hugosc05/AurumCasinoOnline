import { WHEEL_ORDER, numberColor } from '@aurum/engine';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { audio, type LoopHandle } from '../../lib/audio';
import type { WheelHandle } from './RouletteWheel';
import { GEO, POCKETS, POCKET_RAD, deflectorAngle, frameAt, planWheelSpin, surfaceHeight, type WheelRun } from './wheelPhysics';

/**
 * Ruleta europea en 3D (three.js): cuenco de madera lacada, pista, cono con
 * 8 rombos cromados, rotor con 37 bolsillos en el orden real, separadores
 * metálicos, torreta y bola de resina. La bola sigue la simulación física de
 * `wheelPhysics.ts`, calculada antes de empezar y que termina en el número que
 * ya decidió el servidor.
 *
 * Convención de ángulos (vista desde arriba): positivo = sentido antihorario.
 * Un punto (r, θ) está en x = r·cos θ, z = −r·sin θ; girar un grupo +a sobre
 * el eje Y equivale a sumar a a su ángulo.
 */

const TAU = Math.PI * 2;
const COLORS = { red: '#a3202f', black: '#111722', green: '#0f6b47' } as const;
const RIM_R = 0.46;

const xz = (r: number, a: number): [number, number] => [r * Math.cos(a), -r * Math.sin(a)];

/* ------------------------------ Texturas ------------------------------ */

/** Corona de números y fondos de bolsillo, dibujada en polar (u,v ← posición x,z). */
function wheelFaceTexture(maxAniso: number): THREE.CanvasTexture {
  const S = 2048;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const cx = S / 2;
  const k = S / 2 / GEO.rotorR; // píxeles por metro
  const P = (r: number, a: number): [number, number] => [cx + r * k * Math.cos(a), cx - r * k * Math.sin(a)];
  g.fillStyle = '#2b190c';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < POCKETS; i += 1) {
    const a0 = (i - 0.5) * POCKET_RAD;
    const a1 = (i + 0.5) * POCKET_RAD;
    const col = COLORS[numberColor(WHEEL_ORDER[i]!)];
    // Banda de números (corona inclinada) y fondo del bolsillo.
    for (const [r0, r1, shade] of [[GEO.pocketOutR + 0.002, GEO.rotorR, 1], [GEO.pocketInR, GEO.pocketOutR, 0.78]] as const) {
      g.beginPath();
      g.arc(cx, cx, r1 * k, -a0, -a1, true);
      g.arc(cx, cx, r0 * k, -a1, -a0, false);
      g.closePath();
      const grad = g.createRadialGradient(cx, cx, r0 * k, cx, cx, r1 * k);
      grad.addColorStop(0, shadeColor(col, shade * 0.75));
      grad.addColorStop(0.5, shadeColor(col, shade));
      grad.addColorStop(1, shadeColor(col, shade * 0.82));
      g.fillStyle = grad;
      g.fill();
    }
    // Número, orientado hacia fuera.
    const [tx, ty] = P((GEO.pocketOutR + GEO.rotorR) / 2 + 0.002, i * POCKET_RAD);
    g.save();
    g.translate(tx, ty);
    g.rotate(-i * POCKET_RAD + Math.PI / 2);
    g.fillStyle = '#f6efe0';
    g.font = `700 ${Math.round(0.024 * k)}px "Bodoni Moda Variable", Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(WHEEL_ORDER[i]), 0, 0);
    g.restore();
    // Líneas doradas entre números.
    const [x0, y0] = P(GEO.pocketOutR, a0);
    const [x1, y1] = P(GEO.rotorR, a0);
    g.strokeStyle = '#d8bb74';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  for (const r of [GEO.pocketOutR, GEO.rotorR - 0.002, GEO.pocketInR]) {
    g.strokeStyle = '#e2c47e';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cx, r * k, 0, TAU);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function shadeColor(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** Madera con vetas concéntricas (cuenco y cono central). */
function woodTexture(base: string, dark: string, rings: number): THREE.CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < rings; i += 1) {
    g.strokeStyle = dark;
    g.globalAlpha = 0.05 + rnd() * 0.12;
    g.lineWidth = 1 + rnd() * 4;
    g.beginPath();
    const y = rnd() * S;
    g.moveTo(0, y);
    for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x / 90 + i) * 6 + (rnd() - 0.5) * 3);
    g.stroke();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* ------------------------------ Geometría ----------------------------- */

/** Anillo (posiblemente inclinado) con UV polares compartidas con la textura de la corona. */
function annulus(r0: number, h0: number, r1: number, h1: number, segments: number, uvRadius: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rings = 4;
  for (let s = 0; s <= segments; s += 1) {
    const a = (s / segments) * TAU;
    for (let k = 0; k <= rings; k += 1) {
      const f = k / rings;
      const r = r0 + (r1 - r0) * f;
      const h = h0 + (h1 - h0) * f;
      const [x, z] = xz(r, a);
      pos.push(x, h, z);
      uv.push(0.5 + x / (2 * uvRadius), 0.5 - z / (2 * uvRadius));
    }
  }
  const row = rings + 1;
  for (let s = 0; s < segments; s += 1) {
    for (let k = 0; k < rings; k += 1) {
      const a = s * row + k;
      const b = (s + 1) * row + k;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function lathe(points: [number, number][], segments = 160): THREE.LatheGeometry {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rotor: THREE.Group;
  ball: THREE.Mesh;
  ballShadow: THREE.Mesh;
  highlight: THREE.Mesh;
  dispose(): void;
}

function buildScene(canvas: HTMLCanvasElement, quality: 'high' | 'low'): Scene3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  camera.position.set(0, 1.28, 1.12);
  camera.lookAt(0, -0.03, 0.04);

  // Luces: cenital cálida (como la lámpara de la mesa) y relleno suave.
  const key = new THREE.SpotLight(0xfff1d6, 26, 6, Math.PI / 5, 0.55, 1.2);
  key.position.set(0.35, 2.3, 0.55);
  key.target.position.set(0, 0, 0);
  key.castShadow = quality === 'high';
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x1a1008, 0.55));

  const aniso = renderer.capabilities.getMaxAnisotropy();
  const wood = woodTexture('#3b1d0b', '#120802', 160);
  wood.repeat.set(6, 1);
  const lacquer = (map: THREE.Texture | null, color: number, rough = 0.32): THREE.MeshPhysicalMaterial =>
    new THREE.MeshPhysicalMaterial({ map, color, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.12 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xf2f2f5, metalness: 1, roughness: 0.16 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd9b46a, metalness: 1, roughness: 0.24 });

  // Suelo invisible que solo recoge sombras (la ruleta "apoya" sobre el panel) y sombra de contacto suave.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.051;
  floor.receiveShadow = true;
  scene.add(floor);
  const contact = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 30, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), new THREE.MeshBasicMaterial({ map: contact, transparent: true, depthWrite: false }));
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = -0.052;
  scene.add(contactShadow);

  // Cuenco fijo: canto exterior, labio, pared de la pista, pista y cono hasta el rotor.
  const bowl = new THREE.Mesh(
    lathe([
      [GEO.rotorR - 0.01, -0.05],
      [RIM_R + 0.004, -0.05],
      [RIM_R + 0.016, -0.035],
      [RIM_R + 0.018, 0.05],
      [RIM_R + 0.008, 0.074],
      [RIM_R - 0.012, 0.08],
      [0.43, 0.077],
      [0.42, 0.07],
      [GEO.trackR + GEO.ballR + 0.003, GEO.trackH + 0.008],
      [GEO.trackR, GEO.trackH - 0.002],
      [GEO.trackR - 0.012, GEO.trackH - 0.004],
      [GEO.rotorR + 0.004, GEO.rotorH + 0.002],
      [GEO.rotorR + 0.002, GEO.rotorH - 0.004],
      [GEO.rotorR - 0.004, -0.02],
    ]),
    lacquer(wood, 0xd9b49a, 0.36),
  );
  bowl.receiveShadow = true;
  scene.add(bowl);
  // Filete metálico en el borde de la pista.
  const trackEdge = new THREE.Mesh(new THREE.TorusGeometry(0.424, 0.0028, 10, 200), brass);
  trackEdge.rotation.x = Math.PI / 2;
  trackEdge.position.y = 0.074;
  scene.add(trackEdge);

  // Rombos (deflectores): 8 en el cono, alternando verticales y horizontales.
  const diamondGeo = new THREE.OctahedronGeometry(0.012, 0);
  for (let i = 0; i < GEO.deflectors; i += 1) {
    const d = new THREE.Mesh(diamondGeo, chrome);
    const [x, z] = xz(GEO.deflectorR, deflectorAngle(i));
    d.position.set(x, surfaceHeight(GEO.deflectorR) + 0.004, z);
    d.rotation.y = deflectorAngle(i);
    if (i % 2) d.scale.set(1.8, 0.55, 0.7);
    else d.scale.set(0.7, 0.55, 1.8);
    d.castShadow = true;
    scene.add(d);
  }

  // Rotor (gira): corona de números, bolsillos, separadores, cono central y torreta.
  const rotor = new THREE.Group();
  scene.add(rotor);
  const faceTex = wheelFaceTexture(aniso);
  const faceMat = lacquer(faceTex, 0xffffff, 0.38);
  const numberRing = new THREE.Mesh(annulus(GEO.pocketOutR, GEO.seatH + 0.008, GEO.rotorR, GEO.rotorH, POCKETS * 8, GEO.rotorR), faceMat);
  const pocketFloor = new THREE.Mesh(annulus(GEO.pocketInR, GEO.seatH - GEO.ballR * 0.2, GEO.pocketOutR, GEO.seatH - GEO.ballR * 0.2, POCKETS * 8, GEO.rotorR), faceMat);
  numberRing.receiveShadow = true;
  pocketFloor.receiveShadow = true;
  rotor.add(numberRing, pocketFloor);
  // Paredes interior y exterior de los bolsillos (metal).
  for (const [r, h] of [[GEO.pocketOutR, GEO.fretH], [GEO.pocketInR, GEO.fretH + 0.004]] as const) {
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 160, 1, true), chrome);
    wall.position.y = GEO.seatH + h / 2 - GEO.ballR * 0.2;
    wall.receiveShadow = true;
    rotor.add(wall);
  }
  // Separadores entre bolsillos.
  const fretGeo = new THREE.BoxGeometry(GEO.pocketOutR - GEO.pocketInR, GEO.fretH, 0.0035);
  const frets = new THREE.InstancedMesh(fretGeo, chrome, POCKETS);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < POCKETS; i += 1) {
    const a = (i + 0.5) * POCKET_RAD;
    const [x, z] = xz((GEO.pocketOutR + GEO.pocketInR) / 2, a);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    m.compose(new THREE.Vector3(x, GEO.seatH + GEO.fretH / 2 - GEO.ballR * 0.2, z), q, new THREE.Vector3(1, 1, 1));
    frets.setMatrixAt(i, m);
  }
  frets.castShadow = true;
  rotor.add(frets);
  // Cono central de madera y torreta de latón con sus cuatro brazos.
  const coneWood = woodTexture('#4a2a12', '#1a0c04', 110);
  const cone = new THREE.Mesh(
    lathe([
      [GEO.pocketInR, GEO.seatH + GEO.fretH + 0.002],
      [0.19, 0.024],
      [0.15, 0.04],
      [0.1, 0.052],
      [0.06, 0.058],
      [0.0, 0.06],
    ]),
    lacquer(coneWood, 0xffffff, 0.3),
  );
  cone.receiveShadow = true;
  rotor.add(cone);
  const turret = new THREE.Mesh(
    lathe([
      [0.0, 0.058],
      [0.03, 0.06],
      [0.032, 0.066],
      [0.016, 0.072],
      [0.012, 0.11],
      [0.018, 0.118],
      [0.012, 0.128],
      [0.0, 0.136],
    ], 48),
    brass,
  );
  turret.castShadow = true;
  rotor.add(turret);
  for (let i = 0; i < 4; i += 1) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0045, 0.11, 16), brass);
    arm.rotation.z = Math.PI / 2;
    const holder = new THREE.Group();
    holder.rotation.y = (i * Math.PI) / 2;
    arm.position.set(0.055, 0.1, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 24, 16), brass);
    knob.position.set(0.112, 0.1, 0);
    arm.castShadow = true;
    knob.castShadow = true;
    holder.add(arm, knob);
    rotor.add(holder);
  }

  // Resaltado del bolsillo ganador (se orienta al mostrarlo).
  const hl = new THREE.Mesh(
    annulus(GEO.pocketInR + 0.003, GEO.seatH + 0.0015, GEO.pocketOutR - 0.002, GEO.seatH + 0.0015, 8, GEO.rotorR),
    new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  // Recorta el anillo a un solo bolsillo con un clip por ángulo en el sombreador sería caro: se usa un sector.
  hl.geometry.dispose();
  hl.geometry = sectorGeo(GEO.pocketInR + 0.003, GEO.pocketOutR - 0.002, -POCKET_RAD / 2 + 0.01, POCKET_RAD / 2 - 0.01, GEO.seatH + 0.002);
  rotor.add(hl);

  // Bola de resina y su sombra de contacto.
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(GEO.ballR, 40, 24),
    new THREE.MeshPhysicalMaterial({ color: 0xf7f5ef, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }),
  );
  ball.castShadow = true;
  scene.add(ball);
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.75)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(GEO.ballR * 3.2, GEO.ballR * 3.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2;
  scene.add(ballShadow);

  return {
    renderer,
    scene,
    camera,
    rotor,
    ball,
    ballShadow,
    highlight: hl,
    dispose() {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        for (const mm of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          for (const v of Object.values(mm)) if (v instanceof THREE.Texture) v.dispose();
          mm.dispose();
        }
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}

function sectorGeo(r0: number, r1: number, a0: number, a1: number, h: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const steps = 8;
  for (let s = 0; s <= steps; s += 1) {
    const a = a0 + ((a1 - a0) * s) / steps;
    for (const r of [r0, r1]) {
      const [x, z] = xz(r, a);
      pos.push(x, h, z);
    }
  }
  for (let s = 0; s < steps; s += 1) idx.push(s * 2, s * 2 + 1, s * 2 + 2, s * 2 + 2, s * 2 + 1, s * 2 + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

interface Props {
  highlight?: number | null;
  className?: string;
  label?: string;
  /** Sin sonido (ruleta decorativa de la portada). */
  muted?: boolean;
}

/**
 * Componente: misma interfaz que la ruleta 2.5D (`WheelHandle`), así la página
 * no cambia. Solo dibuja mientras hay movimiento y la ruleta está a la vista.
 */
export const RouletteWheel3D = forwardRef<WheelHandle, Props>(function RouletteWheel3D({ highlight = null, className, label, muted = false }, ref) {
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const state = useRef<{ wheel: number; wheelSpeed: number; ball: { r: number; a: number; y: number }; highlightAt: number }>({ wheel: 0, wheelSpeed: -0.35, ball: { r: GEO.seatR, a: 0, y: GEO.seatH + GEO.ballR }, highlightAt: 0 });
  const running = useRef<{ run: WheelRun; start: number; resolve: () => void; skip: boolean; loop: LoopHandle; nextEvent: number; last: THREE.Vector3 } | null>(null);
  const visible = useRef(true);
  const highlightRef = useRef<number | null>(highlight);

  useEffect(() => {
    highlightRef.current = highlight;
    state.current.highlightAt = performance.now();
  }, [highlight]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const quality = window.matchMedia('(max-width: 640px)').matches ? 'low' : 'high';
    const s3 = buildScene(canvas, quality);
    sceneRef.current = s3;
    const { renderer, scene, camera, rotor, ball, ballShadow } = s3;
    const tmp = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const qStep = new THREE.Quaternion();

    const resize = (): void => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => {
      visible.current = !!e?.isIntersecting;
    });
    io.observe(wrap);

    let last = performance.now();
    let frameNo = 0;
    const place = (r: number, a: number, y: number): void => {
      const [x, z] = xz(r, a);
      tmp.set(x, y, z);
      // Rodadura: la bola gira sobre el eje perpendicular a su desplazamiento.
      const prev = running.current?.last ?? ball.position;
      const dx = tmp.x - prev.x;
      const dz = tmp.z - prev.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-6 && dist < 0.2) {
        axis.set(dz, 0, -dx).normalize();
        qStep.setFromAxisAngle(axis, dist / GEO.ballR);
        ball.quaternion.premultiply(qStep);
      }
      ball.position.copy(tmp);
      if (running.current) running.current.last.copy(tmp);
      const ground = surfaceHeight(r);
      const lift = Math.max(0, y - ground - GEO.ballR);
      ballShadow.position.set(x + lift * 0.25, ground + (r < GEO.pocketOutR ? -GEO.ballR * 0.15 : 0) + 0.0008, z + lift * 0.4);
      const sc = 1 + lift * 18;
      ballShadow.scale.set(sc, sc, sc);
      (ballShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 0.85 - lift * 14);
    };

    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = state.current;
      const run = running.current;
      if (run) {
        const t = run.skip ? run.run.duration : (now - run.start) / 1000;
        const f = frameAt(run.run, t);
        st.wheel = f.wheel;
        st.ball = { r: f.r, a: f.ball, y: f.y };
        // Eventos de sonido.
        const evs = run.run.events;
        while (run.nextEvent < evs.length && evs[run.nextEvent]!.t <= t) {
          const e = evs[run.nextEvent]!;
          if (!run.skip && !mutedRef.current) {
            if (e.kind === 'drop') audio.play('ballDrop');
            else if (e.kind === 'deflector' || e.kind === 'fret') audio.play('ballTick');
            else if (e.kind === 'seat') audio.play('wheelStop');
          }
          run.nextEvent += 1;
        }
        run.loop.setIntensity(f.phase === 'seated' ? 0 : Math.min(1, 0.2 + f.speed / 6));
        if (t >= run.run.duration) {
          run.loop.stop(300);
          st.wheelSpeed = (run.run.frames.at(-1)!.wheel - run.run.frames.at(-2)!.wheel) * 120;
          running.current = null;
          run.resolve();
        }
      } else {
        // Reposo: el rotor sigue girando despacio y la bola descansa en su bolsillo.
        const prev = st.wheel;
        st.wheelSpeed += (-0.35 - st.wheelSpeed) * Math.min(1, dt * 0.5);
        st.wheel += st.wheelSpeed * dt;
        st.ball.a += st.wheel - prev;
      }
      rotor.rotation.y = st.wheel;
      place(st.ball.r, st.ball.a, st.ball.y);
      // Bolsillo ganador: brillo pulsante.
      const hl = s3.highlight;
      const hi = highlightRef.current;
      const mat = hl.material as THREE.MeshBasicMaterial;
      if (hi !== null && !run) {
        hl.rotation.y = hi * POCKET_RAD;
        const age = (now - st.highlightAt) / 1000;
        mat.opacity = Math.min(1, age * 3) * (0.35 + 0.25 * Math.sin(age * 5));
      } else mat.opacity = 0;
      // En reposo basta con 30 imágenes por segundo (ahorra batería); girando, todas las que dé la pantalla.
      frameNo += 1;
      if (visible.current && document.visibilityState === 'visible' && (run || frameNo % 2 === 0)) renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(loop);

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      running.current?.loop.stop(50);
      running.current?.resolve();
      running.current = null;
      s3.dispose();
      sceneRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    spin(pocketIndex, durationMs, bounces) {
      return new Promise<void>((resolve) => {
        running.current?.resolve();
        const st = state.current;
        const run = planWheelSpin({ pocket: pocketIndex, wheelAngle: st.wheel, wheelSpeed: st.wheelSpeed, seed: (Math.random() * 2 ** 31) >>> 0, short: !bounces, tail: 1.4 });
        if (durationMs <= 0) {
          const f = run.frames.at(-1)!;
          st.wheel = f.wheel;
          st.ball = { r: f.r, a: f.ball, y: f.y };
          resolve();
          return;
        }
        if (!mutedRef.current) audio.play('spinStart');
        const silentLoop: LoopHandle = { setIntensity: () => undefined, stop: () => undefined };
        running.current = { run, start: performance.now(), resolve, skip: false, loop: mutedRef.current ? silentLoop : audio.loop('roll'), nextEvent: 0, last: new THREE.Vector3().copy(sceneRef.current?.ball.position ?? new THREE.Vector3()) };
      });
    },
    skip() {
      if (running.current) running.current.skip = true;
    },
    busy() {
      return running.current !== null;
    },
  }));

  return (
    <div ref={wrapRef} className={className} role="img" aria-label={label ?? 'Ruleta europea en 3D'} style={{ aspectRatio: '1 / 0.82' }}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
});
