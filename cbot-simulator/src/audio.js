import { clamp } from './util.js';

// All sound is synthesised with the Web Audio API — no asset files to ship.
//
// Three layers:
//   1. a calm ambient drone pad (the cozy soundtrack bed),
//   2. a filtered-noise "pit roar" whose loudness + brightness track the mood
//      of the pit the player is nearest to,
//   3. one-shot "shout" bursts and an opening "bell" for big footprints.
//
// Browsers block audio until a user gesture, so call resume() from a click/key.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
  }

  // Build the graph lazily on first gesture.
  resume() {
    if (this.started) { this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    const ctx = this.ctx = new Ctx();
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.master.connect(ctx.destination);

    this._buildRoar();
    this._buildPad();
    this.started = true;
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.linearRampToValueAtTime(m ? 0 : 0.9, this.ctx.currentTime + 0.2);
  }

  // ---- layer 2: the pit roar (pink-ish noise through a bandpass) ----
  _buildRoar() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {        // simple low-passed noise = roar
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass';
    this.roarFilter.frequency.value = 500;
    this.roarFilter.Q.value = 0.7;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0.0001;
    src.connect(this.roarFilter).connect(this.roarGain).connect(this.master);
    src.start();
  }

  // ---- layer 1: ambient pad (two detuned sines + slow filter sweep) ----
  _buildPad() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 700;
    [110, 164.81, 220].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      o.detune.value = i * 4 - 4;
      const og = ctx.createGain(); og.gain.value = 0.5 / (i + 1);
      o.connect(og).connect(filt);
      o.start();
    });
    // slow LFO on the filter for gentle movement
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = 250;
    lfo.connect(lg).connect(filt.frequency); lfo.start();
    filt.connect(g).connect(this.master);
  }

  // Drive the roar each frame from the nearest pit's mood (0..1).
  update(mood, dir) {
    if (!this.started || !this.enabled) return;
    const t = this.ctx.currentTime;
    const gain = 0.0001 + clamp(mood, 0, 1) * 0.5;
    this.roarGain.gain.setTargetAtTime(gain, t, 0.15);
    // brighter, edgier roar when the move is up; darker on a sell-off
    const f = 360 + mood * 700 + (dir > 0 ? 140 : 0);
    this.roarFilter.frequency.setTargetAtTime(f, t, 0.2);
    this.roarFilter.Q.setTargetAtTime(0.6 + mood * 2.5, t, 0.2);
  }

  // One-shot shout on a big footprint. `dir` tilts the pitch up/down.
  shout(dir = 1, strength = 1) {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 180 + dir * 60;
    o.frequency.setValueAtTime(base * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.18);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900 + dir * 300; bp.Q.value = 4;
    const g = ctx.createGain();
    const peak = 0.18 * clamp(strength, 0.3, 1.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(bp).connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.4);
  }

  // Brass opening bell.
  bell() {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [523.25, 659.25, 784].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12 / (i + 1), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 2.3);
    });
  }
}
