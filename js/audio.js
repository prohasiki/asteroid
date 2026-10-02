/**
 * audio.js — звук без внешних файлов (Web Audio API).
 *  • Эмбиент космоса: медленно «дышащий» аккорд из расстроенных осцилляторов,
 *    коричневый шум как «солнечный ветер», редкие звёздные искры в ревербераторе.
 *  • Тихие звуки интерфейса: щелчок, переключатель, успех, ошибка, достижение.
 * По умолчанию звук выключен; AudioContext создаётся только по жесту пользователя.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.sparkTimer = null;
  }

  get supported() {
    return Boolean(window.AudioContext || window.webkitAudioContext);
  }

  /** Создать граф при первом включении. */
  ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // Ревербератор с синтезированной импульсной характеристикой.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0.0;
    this.ambient.connect(this.master);
    this.ambient.connect(this.reverb);

    // Аккорд пэда (A1, E2, A2, B2, E3) с медленной модуляцией фильтра.
    const pad = ctx.createBiquadFilter();
    pad.type = 'lowpass';
    pad.frequency.value = 520;
    pad.Q.value = 0.6;
    pad.connect(this.ambient);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(pad.frequency);
    lfo.start();
    [55, 82.41, 110, 123.47, 164.81].forEach((f, i) => {
      for (const detune of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = i % 2 ? 'triangle' : 'sine';
        o.frequency.value = f;
        o.detune.value = detune + i;
        const g = ctx.createGain();
        g.gain.value = 0.05 / (1 + i * 0.35);
        // Медленное «дыхание» громкости каждого голоса.
        const trem = ctx.createOscillator();
        trem.frequency.value = 0.03 + i * 0.011;
        const tremGain = ctx.createGain();
        tremGain.gain.value = g.gain.value * 0.6;
        trem.connect(tremGain).connect(g.gain);
        o.connect(g).connect(pad);
        o.start();
        trem.start();
      }
    });

    // «Солнечный ветер»: коричневый шум через полосовой фильтр.
    const noise = ctx.createBufferSource();
    noise.buffer = this.brownNoise(6);
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 340;
    band.Q.value = 0.8;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.07;
    const windDepth = ctx.createGain();
    windDepth.gain.value = 180;
    windLfo.connect(windDepth).connect(band.frequency);
    windLfo.start();
    const windGain = ctx.createGain();
    windGain.gain.value = 0.16;
    noise.connect(band).connect(windGain).connect(this.ambient);
    noise.start();

    // Шина эффектов интерфейса.
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.8;
    this.sfx.connect(this.master);
    const sfxWet = ctx.createGain();
    sfxWet.gain.value = 0.25;
    this.sfx.connect(sfxWet).connect(this.reverb);
    return true;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  brownNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  /** Включить/выключить звук; возвращает новое состояние. */
  toggleEnabled() {
    if (!this.enabled) {
      if (!this.ensure()) return false;
      this.ctx.resume();
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0.32, t, 0.6);
      this.ambient.gain.setTargetAtTime(1.0, t, 2.5);
      this.enabled = true;
      this.scheduleSparkles();
    } else {
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(0, t, 0.25);
      this.enabled = false;
      clearTimeout(this.sparkTimer);
      setTimeout(() => { if (!this.enabled) this.ctx.suspend(); }, 1500);
    }
    return this.enabled;
  }

  /** Редкие «звёздные искры» высоко в ревербераторе. */
  scheduleSparkles() {
    clearTimeout(this.sparkTimer);
    if (!this.enabled) return;
    const notes = [880, 987.77, 1318.51, 1479.98, 1760];
    this.tone(notes[Math.floor(Math.random() * notes.length)], 2.2, 0.018, 'sine', this.reverb);
    this.sparkTimer = setTimeout(() => this.scheduleSparkles(), 4000 + Math.random() * 7000);
  }

  tone(freq, dur, gain, type = 'sine', dest = null, when = 0, glideTo = null) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  click() {
    this.tone(1240, 0.07, 0.05, 'sine', null, 0, 820);
  }

  switchSound(on) {
    this.tone(on ? 660 : 440, 0.09, 0.045, 'triangle', null, 0, on ? 990 : 330);
  }

  success() {
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.35, 0.06, 'sine', null, i * 0.07));
  }

  error() {
    this.tone(220, 0.32, 0.07, 'sawtooth', null, 0, 140);
  }

  achievement() {
    [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => this.tone(f, 0.6, 0.05, 'triangle', null, i * 0.09));
  }

  whoosh() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.brownNoise(1.6);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + 0.8);
    f.frequency.exponentialRampToValueAtTime(300, t + 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + 1.6);
  }
}
