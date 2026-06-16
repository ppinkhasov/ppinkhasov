import * as THREE from 'three';

// Tiny event emitter shared by the market feeds.
export class Emitter {
  constructor() { this._h = new Map(); }
  on(type, fn) {
    if (!this._h.has(type)) this._h.set(type, new Set());
    this._h.get(type).add(fn);
    return () => this._h.get(type)?.delete(fn);
  }
  emit(type, payload) {
    const set = this._h.get(type);
    if (set) for (const fn of set) fn(payload);
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential smoothing toward `target`.
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// A 3-band ramp used as the gradientMap for MeshToonMaterial. This is what
// gives the whole scene its flat, hand-drawn cel-shaded look instead of the
// smooth gradients of standard PBR shading.
export function toonGradient(steps = 3) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// Convenience: a toon material in one call, sharing one gradient map.
const _grad = toonGradient(4);
export function toon(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: _grad, ...opts });
}

// Format a futures price. Bonds/notes quote in 32nds/64ths; everything else
// is shown to two decimals. `tickSize` tells us which world we're in.
export function fmtPrice(price, tickSize) {
  if (tickSize === 1 / 32 || tickSize === 1 / 64) {
    const whole = Math.floor(price);
    const denom = tickSize === 1 / 32 ? 32 : 64;
    const frac = Math.round((price - whole) * denom);
    return `${whole}'${String(frac).padStart(2, '0')}`;
  }
  return price.toFixed(2);
}
