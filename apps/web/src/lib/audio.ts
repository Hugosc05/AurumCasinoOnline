/**
 * Sistema de audio centralizado y opcional.
 *
 * Todos los sonidos se SINTETIZAN en tiempo real con Web Audio (osciladores,
 * ruido filtrado, síntesis aditiva para campanas y metales). No hay archivos de
 * audio de terceros: no hay problemas de licencia y no se descarga nada.
 *
 * Cadena: fuente → (panorama) → bus seco + envío a una reverberación de sala
 * generada por código → compresor → salida. La reverberación es corta y suave:
 * da cuerpo a campanas y fichas sin ensuciar los sonidos rápidos.
 *
 * Desactivado por defecto: no suena nada hasta que el usuario lo activa. El
 * contexto de audio solo se crea tras un gesto del usuario.
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
  | 'error'
  | 'spinStart'
  | 'wheelStop'
  | 'lineWin'
  | 'firework'
  | 'coins'
  | 'anticipation'
  | 'peg'
  | 'bucket'
  | 'cashout'
  | 'crash'
  | 'bingoBall'
  | 'caseOpen'
  | 'caseTick'
  | 'caseReveal';

export interface PlayOptions {
  /** Panorama estéreo (−1 izquierda … 1 derecha). */
  pan?: number;
  /** Variación de tono (1 = normal). */
  rate?: number;
}

export interface LoopHandle {
  setIntensity(v: number): void;
  stop(fadeMs?: number): void;
}

const NOOP_LOOP: LoopHandle = { setIntensity: () => {}, stop: () => {} };

/** Separación mínima (s) entre dos instancias del mismo sonido: evita saturación y efectos "metralleta". */
const MIN_GAP: Partial<Record<SoundName, number>> = {
  chip: 0.04, chips: 0.08, cardSlide: 0.05, cardLand: 0.05, cardFlip: 0.06, ballTick: 0.03, reelStop: 0.05,
  lineWin: 0.12, winSmall: 0.4, winMedium: 0.6, winBig: 1.5, lose: 0.5, firework: 0.12, coins: 0.3, click: 0.03, anticipation: 0.8, peg: 0.012, bucket: 0.03, cashout: 0.15, crash: 0.5, bingoBall: 0.3, caseOpen: 0.5, caseTick: 0.018, caseReveal: 0.8,
};

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.6;
  private unlocked = false;
  private last = new Map<SoundName, number>();
  private voices: number[] = [];

  /** Ha habido un gesto del usuario (los navegadores permiten crear el audio a partir de entonces). */
  private gestured = false;

  configure(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.enabled && !this.ctx && this.gestured) this.create();
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? this.volume * 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  /**
   * Llamar desde un gesto del usuario (clic/tecla). Si el sonido está
   * desactivado no se crea nada: el motor de audio no consume recursos ni
   * retrasa la primera interacción.
   */
  unlock(): void {
    this.gestured = true;
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.enabled) void this.ctx.resume();
      return;
    }
    if (this.enabled) this.create();
  }

  private create(): void {
    if (this.unlocked) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume * 0.8 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    const conv = ctx.createConvolver();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.32;
    const pre = ctx.createBiquadFilter();
    pre.type = 'lowpass';
    pre.frequency.value = 6500;
    this.wet.connect(pre).connect(conv).connect(this.master);

    // Ruido base (1 s) para los sonidos de fricción y golpes.
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    this.unlocked = true;
    // La reverberación se genera fuera del gesto para no retrasar la interacción.
    window.setTimeout(() => {
      conv.buffer = this.impulse(1.2, 3.2);
    }, 0);
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i += 1) {
        const t = i / len;
        // Primeras reflexiones algo más densas y cola que decae exponencialmente.
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < ctx.sampleRate * 0.012 ? 0.3 : 1);
      }
    }
    return buf;
  }

  private ready(): AudioContext | null {
    if (!this.enabled || !this.ctx || !this.master) return null;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Conecta un nodo a la salida con panorama y envío de reverberación. */
  private out(node: AudioNode, pan = 0, send = 0.15): void {
    const ctx = this.ctx!;
    let tail: AudioNode = node;
    if (pan !== 0 && 'createStereoPanner' in ctx) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      tail = node.connect(p);
    }
    tail.connect(this.dry!);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      tail.connect(s).connect(this.wet!);
    }
  }

  /** Oscilador con envolvente percusiva. */
  private tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, o: { glideTo?: number; attack?: number; pan?: number; send?: number } = {}): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, start + dur);
    const a = o.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + a);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    this.out(g, o.pan ?? 0, o.send ?? 0.1);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }

  /** Ruido filtrado con envolvente. */
  private burst(start: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', o: { sweepTo?: number; pan?: number; send?: number; attack?: number } = {}): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, start);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, start + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + (o.attack ?? Math.min(0.006, dur / 3)));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g);
    this.out(g, o.pan ?? 0, o.send ?? 0.05);
    src.start(start, Math.random() * 0.3);
    src.stop(start + dur + 0.03);
  }

  /**
   * Campana / carillón por síntesis aditiva: parciales inarmónicos con caídas
   * distintas (los agudos se apagan antes), como una campana de metal real.
   */
  private bell(freq: number, start: number, dur: number, gain: number, pan = 0): void {
    const partials: [number, number, number][] = [
      [1, 1, 1],
      [2.0, 0.55, 0.75],
      [2.76, 0.35, 0.5],
      [5.4, 0.18, 0.28],
      [8.93, 0.08, 0.16],
    ];
    for (const [ratio, amp, life] of partials) this.tone(freq * ratio, start, dur * life, 'sine', gain * amp, { attack: 0.003, pan, send: 0.35 });
    // Golpe del martillo.
    this.burst(start, 0.02, freq * 4, 1.5, gain * 0.5, 'bandpass', { pan, send: 0.1 });
  }

  /** Tintineo metálico de ficha o moneda (parciales inarmónicos muy cortos). */
  private clink(start: number, base: number, gain: number, pan = 0): void {
    [1, 1.47, 2.09, 2.56].forEach((r, i) => this.tone(base * r, start, 0.05 + 0.06 / (i + 1), 'sine', gain / (i + 1.2), { attack: 0.001, pan, send: 0.18 }));
    this.burst(start, 0.012, 6500, 2, gain * 0.8, 'highpass', { pan });
  }

  play(name: SoundName, delayMs = 0, opts: PlayOptions = {}): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + delayMs / 1000;
    const prev = this.last.get(name);
    if (prev !== undefined && Math.abs(t - prev) < (MIN_GAP[name] ?? 0.05)) return;
    this.voices = this.voices.filter((end) => end > ctx.currentTime);
    if (this.voices.length >= 20 && name !== 'winBig' && name !== 'achievement') return;
    this.voices.push(t + 0.6);
    this.last.set(name, t);
    const j = (): number => (0.95 + Math.random() * 0.1) * (opts.rate ?? 1);
    const pan = opts.pan ?? 0;
    switch (name) {
      case 'click':
        this.burst(t, 0.012, 3200, 3, 0.12, 'bandpass', { pan });
        this.tone(1800 * j(), t, 0.03, 'sine', 0.04, { pan });
        break;
      case 'cardSlide':
        // Fricción de papel sobre tapete: ruido que barre de agudo a medio.
        this.burst(t, 0.17, 4200 * j(), 0.8, 0.14, 'bandpass', { sweepTo: 1300, pan, attack: 0.03 });
        this.burst(t, 0.12, 900, 0.7, 0.05, 'lowpass', { pan });
        break;
      case 'cardLand':
        this.burst(t, 0.035, 2200, 1, 0.18, 'bandpass', { pan });
        this.burst(t, 0.06, 500, 0.8, 0.1, 'lowpass', { pan });
        break;
      case 'cardFlip':
        // Chasquido doble del canto de la carta.
        this.burst(t, 0.018, 5200 * j(), 2.5, 0.16, 'highpass', { pan });
        this.burst(t + 0.028, 0.03, 3000 * j(), 1.6, 0.12, 'bandpass', { pan });
        break;
      case 'chip':
        this.clink(t, 2900 * j(), 0.07, pan);
        break;
      case 'chips':
        for (let i = 0; i < 5; i += 1) this.clink(t + i * (0.028 + Math.random() * 0.03), 2600 + Math.random() * 900, 0.05, pan + (Math.random() - 0.5) * 0.3);
        this.burst(t, 0.16, 1800, 0.6, 0.03, 'bandpass', { pan });
        break;
      case 'reelStop':
        // Golpe mecánico: cuerpo grave + chasquido del freno + pequeño traqueteo.
        this.tone(78 * j(), t, 0.16, 'sine', 0.28, { glideTo: 48, pan, send: 0.08 });
        this.tone(160 * j(), t, 0.07, 'triangle', 0.1, { glideTo: 110, pan });
        this.burst(t, 0.025, 2600 * j(), 1.4, 0.2, 'bandpass', { pan });
        this.burst(t + 0.035, 0.02, 1700, 2, 0.07, 'bandpass', { pan });
        this.burst(t + 0.06, 0.015, 1500, 2, 0.04, 'bandpass', { pan });
        break;
      case 'ballTick':
        this.burst(t, 0.012, 3600 * j(), 3, 0.06, 'bandpass', { pan });
        this.tone(2300 * j(), t, 0.02, 'sine', 0.02, { pan });
        break;
      case 'ballDrop':
        [0, 0.11, 0.19, 0.25, 0.29].forEach((dt, i) => {
          this.burst(t + dt, 0.02, 3000 - i * 250, 2.5, 0.12 / (i + 1), 'bandpass', { pan });
          this.tone(1500 - i * 120, t + dt, 0.04, 'triangle', 0.05 / (i + 1), { pan });
        });
        break;
      case 'winSmall':
        this.bell(1046.5, t, 0.9, 0.06);
        this.bell(1318.5, t + 0.11, 1.1, 0.055);
        break;
      case 'winMedium':
        [784, 987.8, 1174.7, 1568].forEach((f, i) => this.bell(f, t + i * 0.09, 1.2, 0.055, (i - 1.5) * 0.25));
        break;
      case 'winBig': {
        // Fanfarria breve de campanas + acorde de fondo; dura ~2,5 s (sin bucles).
        const notes = [523.3, 659.3, 784, 1046.5, 784, 1046.5, 1318.5, 1568];
        notes.forEach((f, i) => this.bell(f, t + i * 0.1, 1.4, 0.055, Math.sin(i) * 0.4));
        this.pad([261.6, 329.6, 392, 523.3], t + 0.05, 2.3, 0.035);
        break;
      }
      case 'lose':
        // Discreto: sin "sonido triste" insistente.
        this.tone(392, t, 0.25, 'sine', 0.035, { glideTo: 370 });
        break;
      case 'push':
        this.bell(784, t, 0.6, 0.04);
        break;
      case 'achievement':
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.bell(f, t + i * 0.07, 1.3, 0.045, (i - 1.5) * 0.3));
        break;
      case 'error':
        this.tone(196, t, 0.12, 'triangle', 0.06);
        this.tone(185, t + 0.13, 0.16, 'triangle', 0.05);
        break;
      case 'spinStart':
        // Trinquete de la palanca + soltar el muelle.
        for (let i = 0; i < 6; i += 1) this.burst(t + i * 0.032 * (1 - i * 0.07), 0.012, 2400 + i * 160, 3, 0.09, 'bandpass');
        this.tone(120, t + 0.2, 0.18, 'sine', 0.14, { glideTo: 70 });
        this.burst(t + 0.18, 0.3, 700, 0.7, 0.06, 'bandpass', { sweepTo: 2200 });
        break;
      case 'wheelStop':
        this.burst(t, 0.03, 2400, 2, 0.1, 'bandpass', { send: 0.2 });
        this.tone(220, t, 0.25, 'sine', 0.08, { glideTo: 180 });
        break;
      case 'lineWin':
        this.bell(1568 * (opts.rate ?? 1), t, 0.7, 0.045, pan);
        break;
      case 'firework':
        // Silbido ascendente, estallido y crepitar.
        this.tone(1300 * j(), t, 0.35, 'sine', 0.025, { glideTo: 2600, pan, send: 0.2 });
        this.tone(70, t + 0.36, 0.5, 'sine', 0.18, { glideTo: 38, pan, send: 0.4 });
        this.burst(t + 0.36, 0.6, 1400, 0.5, 0.12, 'lowpass', { sweepTo: 300, pan, send: 0.4 });
        for (let i = 0; i < 10; i += 1) this.burst(t + 0.45 + Math.random() * 0.5, 0.01, 5000 + Math.random() * 3000, 3, 0.04, 'highpass', { pan: pan + (Math.random() - 0.5) * 0.6, send: 0.3 });
        break;
      case 'coins':
        for (let i = 0; i < 12; i += 1) this.clink(t + i * 0.045 + Math.random() * 0.02, 2400 + Math.random() * 1600, 0.045, (Math.random() - 0.5) * 0.8);
        break;
      case 'peg':
        // Clavo de plinko: golpecito seco, más agudo cuanto más abajo (opts.rate).
        this.burst(t, 0.008, 4200 * (opts.rate ?? 1), 4, 0.05, 'bandpass', { pan });
        this.tone(1900 * (opts.rate ?? 1), t, 0.025, 'sine', 0.018, { pan });
        break;
      case 'bucket':
        this.tone(660 * (opts.rate ?? 1), t, 0.12, 'triangle', 0.05, { pan, glideTo: 520 * (opts.rate ?? 1) });
        this.burst(t, 0.02, 1800, 2, 0.06, 'bandpass', { pan });
        break;
      case 'cashout':
        this.clink(t, 2900, 0.07, pan);
        this.bell(1318.5, t + 0.04, 0.8, 0.05, pan);
        this.bell(1760, t + 0.12, 0.9, 0.045, pan);
        break;
      case 'crash':
        // Explosión: golpe grave + ruido que se apaga.
        this.tone(90, t, 0.6, 'sine', 0.22, { glideTo: 35, send: 0.4 });
        this.burst(t, 0.9, 2200, 0.4, 0.16, 'lowpass', { sweepTo: 180, send: 0.4 });
        this.burst(t, 0.05, 5000, 1, 0.1, 'highpass');
        break;
      case 'bingoBall':
        // La bola sale del bombo y rueda por el tubo.
        [0, 0.07, 0.13, 0.18].forEach((dt, i) => this.burst(t + dt, 0.015, 2600 - i * 300, 3, 0.08 / (i + 1), 'bandpass', { pan }));
        this.burst(t + 0.2, 0.35, 900, 0.8, 0.05, 'bandpass', { sweepTo: 600, pan });
        this.tone(880, t + 0.55, 0.3, 'sine', 0.03);
        break;
      case 'caseOpen':
        // Cierre metálico que salta y la tapa que se abre (inspirado en las cajas de CS:GO, sintetizado).
        this.burst(t, 0.02, 2400, 4, 0.12, 'bandpass', { pan });
        this.tone(320, t, 0.06, 'square', 0.03, { glideTo: 180, pan });
        this.burst(t + 0.09, 0.025, 3200, 5, 0.09, 'bandpass', { pan });
        this.tone(1250, t + 0.09, 0.08, 'triangle', 0.03, { pan });
        this.burst(t + 0.14, 0.45, 600, 0.7, 0.07, 'bandpass', { sweepTo: 3800, pan, attack: 0.12, send: 0.2 });
        break;
      case 'caseTick': {
        // «Tic» seco de la cinta al pasar cada casilla por la línea central.
        const r = opts.rate ?? 1;
        this.burst(t, 0.006, 5200 * r, 6, 0.09, 'bandpass', { pan });
        this.tone(1750 * r, t, 0.018, 'square', 0.012, { pan });
        this.tone(880 * r, t, 0.012, 'triangle', 0.02, { pan });
        break;
      }
      case 'caseReveal': {
        // Golpe y acorde brillante al detenerse; más alto y largo cuanto más rara (opts.rate).
        const r = opts.rate ?? 1;
        this.burst(t, 0.05, 1800, 1, 0.1, 'lowpass', { send: 0.3 });
        this.tone(110 * r, t, 0.25, 'sine', 0.12, { glideTo: 70 });
        [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => this.bell(f * r, t + 0.04 + i * 0.05, 1 + r * 0.4, 0.045, (i - 1.5) * 0.3));
        this.burst(t + 0.05, 0.8, 7000, 0.6, 0.03, 'highpass', { send: 0.5 });
        break;
      }
      case 'anticipation':
        // Tensión ascendente con trémolo (dura lo que la espera extra del rodillo).
        this.tremolo(t, 0.9, 440, 880, 0.05, pan);
        break;
    }
  }

  /** Acorde sostenido suave (dientes de sierra desafinados y filtrados). */
  private pad(freqs: number[], start: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, start);
    f.frequency.linearRampToValueAtTime(2400, start + dur * 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.25);
    g.gain.setValueAtTime(gain, start + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    f.connect(g);
    this.out(g, 0, 0.4);
    for (const fr of freqs) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        o.connect(f);
        o.start(start);
        o.stop(start + dur + 0.05);
      }
    }
  }

  private tremolo(start: number, dur: number, from: number, to: number, gain: number, pan: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(from, start);
    o.frequency.exponentialRampToValueAtTime(to, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.1);
    g.gain.setValueAtTime(gain, start + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lg = ctx.createGain();
    lg.gain.value = gain * 0.6;
    lfo.connect(lg).connect(g.gain);
    o.connect(g);
    this.out(g, pan, 0.25);
    o.start(start);
    lfo.start(start);
    o.stop(start + dur + 0.05);
    lfo.stop(start + dur + 0.05);
  }

  /**
   * Contador de premio: tics que suben de tono durante `durationMs`, como un
   * marcador mecánico. Se apaga solo; no se repite.
   */
  countUp(durationMs: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const start = ctx.currentTime + 0.05;
    const dur = Math.min(3, durationMs / 1000);
    const n = Math.max(4, Math.round(dur * 16));
    for (let i = 0; i < n; i += 1) {
      const p = i / n;
      // Más rápido al principio y más espaciado al final (como el contador visual).
      const at = start + dur * (1 - Math.pow(1 - p, 2)) * 0.95;
      this.tone(900 + 900 * p, at, 0.05, 'triangle', 0.03 * (1 - p * 0.4), { attack: 0.002, send: 0.05 });
    }
  }

  /** Barajado tipo "riffle": ráfaga de pequeños chasquidos de cartas. */
  riffle(durationMs: number, delayMs = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const start = ctx.currentTime + delayMs / 1000;
    const n = Math.max(8, Math.round(durationMs / 22));
    for (let i = 0; i < n; i += 1) {
      const p = i / n;
      const at = start + (p * durationMs) / 1000 + Math.random() * 0.005;
      this.burst(at, 0.018, 3400 + Math.random() * 1800, 2.2, 0.05 + 0.06 * Math.sin(p * Math.PI), 'bandpass', { pan: (p - 0.5) * 0.5 });
    }
    // Asentamiento final del mazo.
    this.burst(start + durationMs / 1000, 0.05, 1200, 1, 0.1, 'bandpass');
  }

  /**
   * Bucle continuo: rodadura de la bola o rodillos girando. La intensidad
   * (0..1) modula volumen y brillo; siempre termina con `stop()`.
   */
  loop(kind: 'roll' | 'reels' | 'rocket'): LoopHandle {
    const ctx = this.ready();
    if (!ctx || !this.noise) return NOOP_LOOP;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = 0;
    this.out(g, 0, kind === 'roll' ? 0.15 : kind === 'rocket' ? 0.05 : 0.08);
    const nodes: AudioScheduledSourceNode[] = [];

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'roll' ? 'bandpass' : 'lowpass';
    f.frequency.value = kind === 'roll' ? 1200 : kind === 'rocket' ? 340 : 520;
    f.Q.value = kind === 'roll' ? 0.8 : 0.9;
    src.connect(f).connect(g);
    nodes.push(src);

    let tickGain: GainNode | null = null;
    let tickF: BiquadFilterNode | null = null;
    if (kind === 'reels') {
      // Motor: zumbido grave.
      const hum = ctx.createOscillator();
      hum.type = 'sawtooth';
      hum.frequency.value = 58;
      const hf = ctx.createBiquadFilter();
      hf.type = 'lowpass';
      hf.frequency.value = 180;
      const hg = ctx.createGain();
      hg.gain.value = 0.35;
      hum.connect(hf).connect(hg).connect(g);
      nodes.push(hum);
      // Traqueteo de los símbolos al pasar: ruido agudo modulado por un pulso.
      const tick = ctx.createBufferSource();
      tick.buffer = this.noise;
      tick.loop = true;
      tickF = ctx.createBiquadFilter();
      tickF.type = 'bandpass';
      tickF.frequency.value = 2600;
      tickF.Q.value = 1.6;
      tickGain = ctx.createGain();
      tickGain.gain.value = 0;
      const pulse = ctx.createOscillator();
      pulse.type = 'square';
      pulse.frequency.value = 26;
      const pg = ctx.createGain();
      pg.gain.value = 0.5;
      pulse.connect(pg).connect(tickGain.gain);
      tick.connect(tickF).connect(tickGain).connect(g);
      nodes.push(tick, pulse);
    }
    nodes.forEach((n) => n.start(now));
    const base = kind === 'roll' ? 0.16 : 0.11;
    g.gain.setTargetAtTime(base, now, 0.06);
    let stopped = false;
    return {
      setIntensity: (v) => {
        if (stopped) return;
        const t = ctx.currentTime;
        const k = Math.max(0, Math.min(1, v));
        g.gain.setTargetAtTime(base * (0.25 + 0.75 * k), t, 0.08);
        f.frequency.setTargetAtTime((kind === 'roll' ? 500 : 260) + (kind === 'roll' ? 1200 : 360) * k, t, 0.1);
        if (tickF) tickF.frequency.setTargetAtTime(1800 + 900 * k, t, 0.1);
      },
      stop: (fadeMs = 200) => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, Math.max(0.01, fadeMs / 4000));
        nodes.forEach((n) => n.stop(t + fadeMs / 1000 + 0.15));
      },
    };
  }
}

export const audio = new AudioEngine();
export type { SoundName };
