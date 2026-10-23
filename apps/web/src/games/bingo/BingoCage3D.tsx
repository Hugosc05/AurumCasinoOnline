import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { audio } from '../../lib/audio';
import { ballColor } from './ballColors';
import { CAGE, createBalls, stepCage, type CageBall } from './cagePhysics';

/**
 * Bombo de bingo en 3D: jaula esférica de alambre cromado que gira sobre su
 * eje, 90 bolas de resina numeradas que ruedan y chocan con física real,
 * soporte de latón y madera, rampa de salida y cazoleta donde queda la bola
 * extraída mirando a cámara. La bola que sale es SIEMPRE la que ya publicó el
 * servidor: aquí solo se representa.
 */

export interface CageHandle {
  /** Coloca el bombo en el estado de una partida (bolas ya extraídas fuera). */
  sync(drawn: readonly number[]): void;
  /** Saca la bola `n` con su animación. */
  draw(n: number, fast?: boolean): Promise<void>;
  /** Todas las bolas de vuelta al bombo (partida nueva). */
  reset(): void;
  setSpinning(on: boolean): void;
}


const CENTER = new THREE.Vector3(0, 0.78, 0);
const TRAY = new THREE.Vector3(0, 0.205, 0.6);

function ballTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const base = ballColor(n);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, base);
  grad.addColorStop(0.5, base);
  grad.addColorStop(1, base);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  // Franja blanca ecuatorial, como las bolas de bingo clásicas.
  g.fillStyle = '#ffffff';
  g.fillRect(0, 44, 256, 40);
  for (const x of [64, 192]) {
    g.beginPath();
    g.arc(x, 64, 30, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = base;
    g.stroke();
    g.fillStyle = '#111111';
    g.font = `900 ${n >= 10 ? 30 : 34}px Manrope, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), x, 66);
    if (n === 6 || n === 9 || n === 66 || n === 69 || n === 68 || n === 89 || n === 86) g.fillRect(x - 10, 82, 20, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface Exit {
  n: number;
  start: number;
  dur: number;
  from: THREE.Vector3;
  resolve: () => void;
}

export const BingoCage3D = forwardRef<CageHandle, { className?: string; reduced?: boolean }>(function BingoCage3D({ className, reduced = false }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const api = useRef<CageHandle | null>(null);
  /** Estado pedido antes de que la escena estuviera lista (carga diferida). */
  const pending = useRef<{ drawn: readonly number[] | null; spinning: boolean }>({ drawn: null, spinning: false });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const quality = window.matchMedia('(max-width: 640px)').matches ? 'low' : 'high';
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality === 'high';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.7;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    camera.position.set(0, 1.05, 2.55);
    camera.lookAt(0, 0.62, 0);

    const key = new THREE.SpotLight(0xfff1d6, 32, 8, Math.PI / 5, 0.5, 1.3);
    key.position.set(0.9, 2.8, 1.4);
    key.target.position.copy(CENTER);
    key.castShadow = quality === 'high';
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xbfd6ff, 1.2);
    rim.position.set(-1.5, 1.6, -1.2);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x1a1008, 0.5));

    const chrome = new THREE.MeshStandardMaterial({ color: 0xf2f3f6, metalness: 1, roughness: 0.12 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd9b46a, metalness: 1, roughness: 0.22 });
    const wood = new THREE.MeshPhysicalMaterial({ color: 0x4a2410, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.15 });
    const felt = new THREE.MeshStandardMaterial({ color: 0x0f4d33, roughness: 0.95 });

    // Suelo que recoge sombras.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Base de madera con tapete y molduras de latón.
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.11, 0.85), wood);
    base.position.set(0, 0.055, 0.12);
    base.castShadow = true;
    base.receiveShadow = true;
    // Tapete verde con un filete de latón alrededor.
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.37, 0.008, 0.77), brass);
    trim.position.set(0, 0.112, 0.12);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.33, 0.008, 0.73), felt);
    top.position.set(0, 0.116, 0.12);
    top.receiveShadow = true;
    scene.add(base, trim, top);

    // Columnas y eje.
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, CENTER.y - 0.12, 20), brass);
      post.position.set(sx * 0.62, (CENTER.y + 0.12) / 2, 0);
      post.castShadow = true;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 24), brass);
      foot.position.set(sx * 0.62, 0.14, 0);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 16), brass);
      cap.position.set(sx * 0.62, CENTER.y, 0);
      scene.add(post, foot, cap);
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 16), chrome);
    axle.rotation.z = Math.PI / 2;
    axle.position.copy(CENTER);
    scene.add(axle);
    // Manivela.
    const crank = new THREE.Group();
    crank.position.set(0.7, CENTER.y, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.16, 0.018), brass);
    arm.position.y = -0.08;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 16), wood);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(0.04, -0.16, 0);
    crank.add(arm, knob);
    scene.add(crank);

    // Jaula: meridianos que contienen el eje X y paralelos perpendiculares a él.
    const cage = new THREE.Group();
    cage.position.copy(CENTER);
    const R = CAGE.radius;
    const wireR = 0.0045;
    const merid = new THREE.TorusGeometry(R, wireR, 6, 120);
    for (let k = 0; k < 12; k += 1) {
      const m = new THREE.Mesh(merid, chrome);
      m.rotation.x = (k * Math.PI) / 12;
      m.castShadow = quality === 'high';
      cage.add(m);
    }
    for (const t of [-0.82, -0.6, -0.32, 0, 0.32, 0.6, 0.82]) {
      const rr = R * Math.sqrt(1 - t * t);
      const p = new THREE.Mesh(new THREE.TorusGeometry(rr, wireR * 1.15, 6, 90), chrome);
      p.rotation.y = Math.PI / 2;
      p.position.x = t * R;
      cage.add(p);
    }
    for (const sx of [-1, 1]) {
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 32), brass);
      hub.rotation.z = Math.PI / 2;
      hub.position.x = sx * R * 0.985;
      cage.add(hub);
    }
    scene.add(cage);

    // Rampa y cazoleta de salida.
    const chuteCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, CENTER.y - R * 0.98, 0.06),
      new THREE.Vector3(0, CENTER.y - R - 0.04, 0.22),
      new THREE.Vector3(0, 0.27, 0.42),
      TRAY.clone().add(new THREE.Vector3(0, -0.01, -0.04)),
    ]);
    const chute = new THREE.Mesh(new THREE.TubeGeometry(chuteCurve, 40, 0.004, 6, false), chrome);
    const chute2 = chute.clone();
    chute.position.x = -CAGE.ballR * 0.75;
    chute2.position.x = CAGE.ballR * 0.75;
    scene.add(chute, chute2);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.05, 40, 1, true), brass);
    cup.position.set(TRAY.x, TRAY.y - CAGE.ballR * 0.75, TRAY.z);
    const cupBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.02, 40), brass);
    cupBase.position.set(TRAY.x, 0.13, TRAY.z);
    cup.castShadow = true;
    scene.add(cup, cupBase);

    // Bolas.
    const ballGeo = new THREE.SphereGeometry(CAGE.ballR, quality === 'high' ? 32 : 20, quality === 'high' ? 20 : 14);
    const numbers = Array.from({ length: 90 }, (_, i) => i + 1);
    let sim: CageBall[] = createBalls(numbers, 7);
    const meshes = new Map<number, THREE.Mesh>();
    for (const n of numbers) {
      const mat = new THREE.MeshPhysicalMaterial({ map: ballTexture(n), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06 });
      const m = new THREE.Mesh(ballGeo, mat);
      m.castShadow = quality === 'high';
      m.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      scene.add(m);
      meshes.set(n, m);
    }
    const acc = { t: 0 };
    let omega = 0.8;
    let targetOmega = 0.8;
    let cageAngle = 0;
    let tray: number | null = null;
    let exit: Exit | null = null;
    const qStep = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const faceCam = new THREE.Quaternion();
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    io.observe(wrap);

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

    const placeTray = (n: number | null): void => {
      if (tray !== null && tray !== n) meshes.get(tray)!.visible = false;
      tray = n;
      if (n === null) return;
      const m = meshes.get(n)!;
      m.visible = true;
      m.position.copy(TRAY);
      m.quaternion.copy(faceCam);
      m.scale.setScalar(1.15);
    };

    const pathAt = (e: Exit, u: number): THREE.Vector3 => {
      // 0–0,25: de su sitio a la boca del bombo; 0,25–0,85: rampa; 0,85–1: entra en la cazoleta con un rebote.
      const mouth = chuteCurve.getPoint(0);
      if (u < 0.25) return tmp.copy(e.from).lerp(mouth, 1 - (1 - u / 0.25) ** 2);
      if (u < 0.85) {
        const k = (u - 0.25) / 0.6;
        return tmp.copy(chuteCurve.getPoint(k * k));
      }
      const k = (u - 0.85) / 0.15;
      return tmp.copy(TRAY).add(new THREE.Vector3(0, Math.abs(Math.sin(k * Math.PI * 2)) * 0.03 * (1 - k), 0));
    };

    let last = performance.now();
    let frame = 0;
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      omega += (targetOmega - omega) * Math.min(1, dt * 1.5);
      cageAngle += omega * dt;
      cage.rotation.x = cageAngle;
      crank.rotation.x = cageAngle;
      if (!reduced || frame % 2 === 0) stepCage(sim, reduced ? dt * 2 : dt, omega, acc);
      for (const b of sim) {
        if (!b.active) continue;
        const m = meshes.get(b.n)!;
        m.position.set(CENTER.x + b.p[0], CENTER.y + b.p[1], CENTER.z + b.p[2]);
        const wl = Math.hypot(b.w[0], b.w[1], b.w[2]);
        if (wl > 1e-3) {
          axis.set(b.w[0] / wl, b.w[1] / wl, b.w[2] / wl);
          qStep.setFromAxisAngle(axis, wl * dt);
          m.quaternion.premultiply(qStep);
        }
      }
      if (exit) {
        const u = Math.min(1, (now - exit.start) / exit.dur);
        const m = meshes.get(exit.n)!;
        m.position.copy(pathAt(exit, u));
        // Rueda por la rampa y al final se gira para enseñar el número.
        if (u < 0.85) {
          axis.set(1, 0, 0);
          qStep.setFromAxisAngle(axis, dt * 14);
          m.quaternion.premultiply(qStep);
        } else m.quaternion.slerp(faceCam, Math.min(1, dt * 10));
        m.scale.setScalar(1 + 0.15 * Math.max(0, (u - 0.85) / 0.15));
        if (u >= 1) {
          const e = exit;
          exit = null;
          placeTray(e.n);
          e.resolve();
        }
      }
      frame += 1;
      if (visible && document.visibilityState === 'visible') renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(loop);

    api.current = {
      sync(drawn) {
        const out = new Set(drawn);
        exit?.resolve();
        exit = null;
        for (const b of sim) {
          b.active = !out.has(b.n);
          meshes.get(b.n)!.visible = b.active;
        }
        placeTray(drawn.length ? drawn[drawn.length - 1]! : null);
      },
      draw(n, fast = false) {
        return new Promise<void>((resolve) => {
          exit?.resolve();
          const b = sim.find((x) => x.n === n);
          if (!b) {
            resolve();
            return;
          }
          if (tray !== null) meshes.get(tray)!.visible = false;
          tray = null;
          b.active = false;
          const m = meshes.get(n)!;
          m.visible = true;
          audio.play('bingoBall');
          exit = { n, start: performance.now(), dur: fast ? 450 : 1500, from: m.position.clone(), resolve };
        });
      },
      reset() {
        exit?.resolve();
        exit = null;
        tray = null;
        sim = createBalls(numbers, Math.floor(Math.random() * 1e6));
        for (const m of meshes.values()) {
          m.visible = true;
          m.scale.setScalar(1);
        }
      },
      setSpinning(on) {
        targetOmega = on ? 2.4 : 0.8;
      },
    };
    if (pending.current.drawn) api.current.sync(pending.current.drawn);
    api.current.setSpinning(pending.current.spinning);

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      exit?.resolve();
      api.current = null;
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (mat) {
          mat.map?.dispose();
          mat.dispose();
        }
      });
      pmrem.dispose();
      renderer.dispose();
    };
  }, [reduced]);

  useImperativeHandle(ref, () => ({
    sync: (d) => {
      pending.current.drawn = d;
      api.current?.sync(d);
    },
    draw: (n, fast) => api.current?.draw(n, fast) ?? Promise.resolve(),
    reset: () => {
      pending.current.drawn = [];
      api.current?.reset();
    },
    setSpinning: (on) => {
      pending.current.spinning = on;
      api.current?.setSpinning(on);
    },
  }), []);

  return (
    <div ref={wrapRef} className={className} role="img" aria-label="Bombo de bingo en 3D" style={{ aspectRatio: '1.25 / 1' }}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
});
