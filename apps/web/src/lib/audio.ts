/**
 * Sistema de audio centralizado y opcional.
 *
 * Todos los sonidos se SINTETIZAN en tiempo real con Web Audio (osciladores y
 * ruido filtrado): no hay archivos de audio de terceros, así que no hay
 * problemas de licencia y no se descarga nada.
 *
 * El contexto de audio solo se crea tras la primera interacción del usuario
 * (los navegadores bloquean el audio automático y Aurum no lo intenta).
 */

type SoundName =
  | 'click'
  | 'cardSlide'
  | 'cardLand'
  | 'cardFlip'
  | 'chip'
  | 'chips'
  | 'reelStop'
  | 'ballTick'
  | 'ballDrop'
  | 'winSmall'
  | 'winMedium'
  | 'winBig'
  | 'lose'
  | 'push'
  | 'achievement'
  | 'error';

export interface LoopHandle {
  setIntensity(v: number): void;
  stop(fadeMs?: number): void;
}

const NOOP_LOOP: LoopHandle = { setIntensity: () => {}, stop: () => {} };

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.6;
  private unlocked = false;

  configure(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? this.volume * 0.7 : 0, this.ctx.currentTime, 0.05);
  }

  /** Llamar desde un gesto del usuario (clic/tecla). */
  unlock(): void {
    if (this.unlocked) {
      void this.ctx?.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume * 0.7 : 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    this.unlocked = true;
  }

  private ready(): AudioContext | null {
    if (!this.enabled || !this.ctx || !this.master) return null;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, glideTo?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  private burst(start: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', sweepTo?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, start);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, start + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.01, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(start, Math.random() * 0.8);
    src.stop(start + dur + 0.02);
  }

  play(name: SoundName, delayMs = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + delayMs / 1000;
    const jitter = (): number => 0.94 + Math.random() * 0.12;
    switch (name) {
      case 'click':
        this.tone(1400 * jitter(), t, 0.04, 'sine', 0.08);
        break;
      case 'cardSlide':
        this.burst(t, 0.16, 2600 * jitter(), 0.9, 0.18, 'bandpass', 900);
        break;
      case 'cardLand':
        this.burst(t, 0.05, 1800, 1.2, 0.22);
        this.tone(140, t, 0.06, 'sine', 0.12);
        break;
      case 'cardFlip':
        this.burst(t, 0.07, 3800 * jitter(), 2, 0.16, 'highpass');
        break;
      case 'chip':
        this.tone(3200 * jitter(), t, 0.09, 'sine', 0.07);
        this.tone(4700 * jitter(), t + 0.004, 0.07, 'sine', 0.05);
        this.burst(t, 0.03, 5000, 3, 0.08, 'highpass');
        break;
      case 'chips':
        for (let i = 0; i < 4; i += 1) {
          const s = t + i * (0.035 + Math.random() * 0.03);
          this.tone(3000 * jitter(), s, 0.08, 'sine', 0.05);
          this.tone(4500 * jitter(), s, 0.06, 'sine', 0.035);
        }
        break;
      case 'reelStop':
        this.tone(95, t, 0.12, 'triangle', 0.2, 60);
        this.burst(t, 0.06, 900, 1.5, 0.14, 'lowpass');
        break;
      case 'ballTick':
        this.tone(2400 * jitter(), t, 0.025, 'square', 0.025);
        break;
      case 'ballDrop':
        this.tone(1800, t, 0.05, 'triangle', 0.08);
        this.tone(1300, t + 0.09, 0.05, 'triangle', 0.06);
        this.tone(1100, t + 0.16, 0.08, 'triangle', 0.05);
        break;
      case 'winSmall':
        [784, 988].forEach((f, i) => this.tone(f, t + i * 0.09, 0.3, 'triangle', 0.09));
        break;
      case 'winMedium':
        [659, 784, 988, 1319].forEach((f, i) => this.tone(f, t + i * 0.085, 0.42, 'triangle', 0.09));
        break;
      case 'winBig':
        [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
          this.tone(f, t + i * 0.09, 0.6, 'triangle', 0.09);
          this.tone(f * 2, t + i * 0.09, 0.3, 'sine', 0.03);
        });
        break;
      case 'lose':
        this.tone(330, t, 0.22, 'sine', 0.06, 290);
        this.tone(247, t + 0.16, 0.32, 'sine', 0.05, 220);
        break;
      case 'push':
        this.tone(523, t, 0.2, 'sine', 0.06);
        break;
      case 'achievement':
        [880, 1109, 1319, 1760].forEach((f, i) => this.tone(f, t + i * 0.06, 0.8, 'sine', 0.06));
        break;
      case 'error':
        this.tone(220, t, 0.14, 'square', 0.04);
        break;
    }
  }

  /** Barajado tipo "riffle": ráfaga de pequeños chasquidos de cartas. */
  riffle(durationMs: number, delayMs = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const start = ctx.currentTime + delayMs / 1000;
    const n = Math.max(8, Math.round(durationMs / 26));
    for (let i = 0; i < n; i += 1) {
      const p = i / n;
      this.burst(start + (p * durationMs) / 1000 + Math.random() * 0.006, 0.022, 3000 + Math.random() * 1500, 2.5, 0.07 + 0.05 * Math.sin(p * Math.PI));
    }
  }

  /** Bucle continuo (rodadura de la bola, rodillos). La intensidad modula volumen y brillo. */
  loop(kind: 'roll' | 'reels'): LoopHandle {
    const ctx = this.ready();
    if (!ctx || !this.noise) return NOOP_LOOP;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = kind === 'roll' ? 1200 : 500;
    f.Q.value = kind === 'roll' ? 0.8 : 2.5;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master!);
    let lfo: OscillatorNode | null = null;
    if (kind === 'reels') {
      lfo = ctx.createOscillator();
      lfo.frequency.value = 18;
      const lg = ctx.createGain();
      lg.gain.value = 0.05;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
    }
    src.start();
    const base = kind === 'roll' ? 0.16 : 0.07;
    g.gain.setTargetAtTime(base, ctx.currentTime, 0.08);
    return {
      setIntensity: (v) => {
        const now = ctx.currentTime;
        g.gain.setTargetAtTime(base * Math.max(0, Math.min(1, v)), now, 0.1);
        f.frequency.setTargetAtTime((kind === 'roll' ? 500 : 300) + 1200 * v, now, 0.1);
      },
      stop: (fadeMs = 200) => {
        const now = ctx.currentTime;
        g.gain.setTargetAtTime(0, now, fadeMs / 4000);
        src.stop(now + fadeMs / 1000 + 0.1);
        lfo?.stop(now + fadeMs / 1000 + 0.1);
      },
    };
  }
}

export const audio = new AudioEngine();
export type { SoundName };
