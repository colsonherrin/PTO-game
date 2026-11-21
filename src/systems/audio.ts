// Fully procedural audio (no sample files): city hum, waves, birds, crickets, engine, UI blips.
export class AudioSys {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private hum!: GainNode;
  private waves!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private nextChirp = 0;
  volume = 0.6;

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    const mkLoop = (freq: number, q: number, gain: number) => {
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return g;
    };
    this.hum = mkLoop(380, 0.5, 0.25);
    this.waves = mkLoop(900, 0.3, 0);
    // engine
    this.engineOsc = ctx.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 40;
    this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 300;
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter); this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOsc.start();
  }

  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = v; }

  update(opts: { night: number; nearBeach: number; driving: boolean; speed: number; t: number }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.hum.gain.setTargetAtTime(0.18 * (1 - opts.nearBeach * 0.7) * (1 - opts.night * 0.4), now, 0.5);
    // waves swell
    const swell = 0.5 + 0.5 * Math.sin(opts.t * 0.6);
    this.waves.gain.setTargetAtTime(opts.nearBeach * (0.15 + swell * 0.35), now, 0.3);
    this.engineGain.gain.setTargetAtTime(opts.driving ? 0.07 + Math.min(Math.abs(opts.speed), 25) * 0.004 : 0, now, 0.1);
    this.engineOsc.frequency.setTargetAtTime(38 + Math.abs(opts.speed) * 4.2, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(250 + Math.abs(opts.speed) * 30, now, 0.1);
    if (opts.t > this.nextChirp) {
      if (opts.night > 0.6) this.cricket(); else if (opts.night < 0.3) this.bird();
      this.nextChirp = opts.t + 0.6 + Math.random() * (opts.night > 0.6 ? 1.2 : 3.5);
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0, delay = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  bird() { const f = 2200 + Math.random() * 1800; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone(f + Math.random() * 300, 0.08, 'sine', 0.025, 600, i * 0.11); }
  cricket() { for (let i = 0; i < 3; i++) this.tone(4300, 0.03, 'square', 0.006, 0, i * 0.05); }
  blip() { this.tone(880, 0.08, 'triangle', 0.08, 300); }
  msg() { this.tone(660, 0.07, 'sine', 0.06, 0); this.tone(990, 0.09, 'sine', 0.05, 0, 0.07); }
  cash() { this.tone(1320, 0.08, 'square', 0.04); this.tone(1760, 0.18, 'square', 0.04, 0, 0.08); }
  horn() { this.tone(370, 0.35, 'sawtooth', 0.08); this.tone(466, 0.35, 'sawtooth', 0.06); }
  crash() {
    const ctx = this.ctx; if (!ctx) return;
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const s = ctx.createBufferSource(); s.buffer = b; const g = ctx.createGain(); g.gain.value = 0.35; s.connect(g); g.connect(this.master); s.start();
  }
  door() { this.tone(180, 0.12, 'square', 0.05, -80); }
  step() { this.tone(120 + Math.random() * 40, 0.04, 'triangle', 0.02, -40); }
}
