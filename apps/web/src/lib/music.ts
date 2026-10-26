/**
 * Banda sonora del salón: jazz lounge generado en directo con Web Audio
 * (piano eléctrico, contrabajo que camina y escobillas). Música original:
 * no hay archivos ni licencias de terceros, y nunca se repite exactamente.
 *
 * - Suena en los menús y baja (sin cortarse) al entrar en una mesa o juego.
 * - Solo empieza tras un gesto del usuario (exigencia de los navegadores).
 * - Programa las notas con antelación (planificador de 25 ms con 150 ms de
 *   margen): no depende de que la página vaya fluida.
 */

const BPM = 86;
const BEAT = 60 / BPM;
const SWING = 0.62; // corchea larga del swing

/** Progresión de 8 compases (Do mayor): ii-V-I-VI y vuelta. */
const PROGRESSION: { root: number; tones: number[] }[] = [
  { root: 50, tones: [53, 57, 60, 64] }, // Dm9 (F A C E)
  { root: 43, tones: [53, 57, 59, 64] }, // G13 (F A B E)
  { root: 48, tones: [52, 55, 59, 62] }, // Cmaj9 (E G B D)
  { root: 45, tones: [55, 58, 61, 65] }, // A7b9 (G Bb C# F)
  { root: 50, tones: [53, 57, 60, 64] }, // Dm9
  { root: 43, tones: [53, 56, 59, 64] }, // G7b13
  { root: 52, tones: [55, 59, 62, 66] }, // Em9
  { root: 45, tones: [55, 58, 61, 64] }, // A7
];

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

class MusicEngine {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private duck: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0; // corcheas desde el inicio
  private enabled = false;
  private volume = 0.35;
  private ducked = false;
  private gestured = false;

  configure(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    if (enabled && this.gestured) this.start();
    else if (!enabled) this.stop();
    this.applyGain(0.4);
  }

  /** En una mesa o juego la música baja para no tapar los efectos ni la concentración. */
  setDucked(on: boolean): void {
    this.ducked = on;
    this.applyGain(1.2);
  }

  /** Con la pestaña oculta la música se pausa (ahorra batería) y vuelve al regresar. */
  setVisible(visible: boolean): void {
    if (!this.ctx) return;
    if (visible && this.enabled) void this.ctx.resume();
    else if (!visible) void this.ctx.suspend();
  }

  unlock(): void {
    this.gestured = true;
    if (this.enabled) this.start();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private applyGain(seconds: number): void {
    if (!this.ctx || !this.out || !this.duck) return;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(this.enabled ? this.volume * 0.55 : 0, t, seconds / 3);
    this.duck.gain.setTargetAtTime(this.ducked ? 0.3 : 1, t, seconds / 3);
  }

  private build(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.duck = ctx.createGain();
    // Tono cálido: recorte de agudos y compresión suave.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    this.duck.connect(tone).connect(comp).connect(this.out).connect(ctx.destination);
    // Reverberación de sala pequeña (impulso de ruido que decae).
    const len = Math.floor(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.reverb.connect(wet).connect(this.duck);
    const nlen = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nlen; i += 1) nd[i] = Math.random() * 2 - 1;
  }

  private start(): void {
    if (!this.ctx) this.build();
    if (!this.ctx || this.timer !== null) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.nextTime = this.ctx.currentTime + 0.1;
    this.applyGain(2.5);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.applyGain(0.4);
  }

  /** Planifica las corcheas que caen en los próximos 150 ms. */
  private schedule(): void {
    const ctx = this.ctx!;
    // Si el navegador frenó el temporizador (pestaña en segundo plano), se retoma sin amontonar notas.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime);
      // Swing: corchea larga y corta alternadas.
      this.nextTime += BEAT * (this.step % 2 === 0 ? SWING : 1 - SWING) * 1;
      this.step += 1;
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 8) % PROGRESSION.length;
    const eighth = step % 8;
    const chord = PROGRESSION[bar]!;
    const next = PROGRESSION[(bar + 1) % PROGRESSION.length]!;
    const beat = Math.floor(eighth / 2);
    const onBeat = eighth % 2 === 0;

    // Contrabajo: una negra por tiempo (fundamental, notas del acorde y aproximación cromática al siguiente).
    if (onBeat) {
      const walk = [chord.root, chord.tones[0]! - 12, chord.tones[1]! - 12, next.root + (Math.random() < 0.5 ? 1 : -1)];
      this.bass(hz(walk[beat]! - 12), t, BEAT * 0.95);
    }
    // Escobillas: barrido en 2 y 4, golpecitos de ride con swing.
    if (onBeat && (beat === 1 || beat === 3)) this.brush(t, 0.22, 0.05);
    if (onBeat || eighth === 3 || eighth === 7) this.ride(t, onBeat ? 0.035 : 0.022);
    // Piano: acorde en el 1 y comping irregular (síncopas, como un pianista de bar).
    if (eighth === 0 && Math.random() < 0.85) this.chord(chord.tones, t, BEAT * 1.6, 0.05);
    if (eighth === 3 && Math.random() < 0.55) this.chord(chord.tones, t, BEAT * 0.8, 0.04);
    if (eighth === 6 && Math.random() < 0.3) this.chord(chord.tones.map((n) => n + 12).slice(1), t, BEAT * 0.6, 0.03);
    // Melodía ocasional (vibráfono): notas del acorde una octava arriba.
    if (bar % 2 === 1 && onBeat && Math.random() < 0.4) {
      const n = chord.tones[Math.floor(Math.random() * chord.tones.length)]! + 12;
      this.vibes(hz(n), t, BEAT * 1.4);
    }
  }

  private env(g: GainNode, t: number, peak: number, attack: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /** Piano eléctrico: senoidal con un poco de FM que se apaga (el «ataque» del Rhodes). */
  private ep(freq: number, t: number, dur: number, vel: number): void {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 1.4, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + 0.25);
    mod.connect(modGain).connect(car.frequency);
    const g = ctx.createGain();
    this.env(g, t, vel, 0.008, dur);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.5;
    car.connect(g).connect(pan);
    pan.connect(this.duck!);
    pan.connect(this.reverb!);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  private chord(notes: number[], t: number, dur: number, vel: number): void {
    notes.forEach((n, i) => this.ep(hz(n), t + i * 0.012 + Math.random() * 0.01, dur, vel * (0.8 + Math.random() * 0.3)));
  }

  private bass(freq: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.25);
    const g = ctx.createGain();
    this.env(g, t, 0.22, 0.012, dur);
    o.connect(f).connect(g).connect(this.duck!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private vibes(freq: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const trem = ctx.createOscillator();
    trem.frequency.value = 5.5;
    const tg = ctx.createGain();
    tg.gain.value = 0.25;
    const g = ctx.createGain();
    this.env(g, t, 0.035, 0.004, dur);
    const amp = ctx.createGain();
    amp.gain.value = 0.75;
    trem.connect(tg).connect(amp.gain);
    o.connect(g).connect(amp);
    amp.connect(this.duck!);
    amp.connect(this.reverb!);
    o.start(t);
    trem.start(t);
    o.stop(t + dur + 0.05);
    trem.stop(t + dur + 0.05);
  }

  private noiseHit(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number, attack: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, gain, attack, dur);
    src.connect(f).connect(g).connect(this.duck!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private brush(t: number, dur: number, gain: number): void {
    this.noiseHit(t, dur, gain, 'bandpass', 2600, 0.05);
  }

  private ride(t: number, gain: number): void {
    this.noiseHit(t, 0.12, gain, 'highpass', 7000, 0.002);
  }
}

export const music = new MusicEngine();
