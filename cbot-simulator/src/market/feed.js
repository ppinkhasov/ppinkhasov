import { Emitter, clamp } from '../util.js';
import { BIG_PRINT_MULT } from '../config.js';

// Footprint aggregation for a single instrument.
//
// A "footprint" in order-flow trading is the per-price-level breakdown of
// volume traded into the bid vs lifted at the ask. We bucket recent prints by
// price level and track buy/sell volume, plus a rolling window of print sizes
// so we can decide what counts as a *big* print relative to normal flow.
class FootprintEngine {
  constructor(tickSize) {
    this.tickSize = tickSize;
    this.levels = new Map();      // price -> { buy, sell }
    this.sizes = [];              // recent print sizes (for the median)
    this.maxSizes = 200;
    this.cumDelta = 0;            // running buy-minus-sell volume
  }

  // Returns a classification for this print: { big, mult, side }.
  add(price, size, side) {
    const key = Math.round(price / this.tickSize) * this.tickSize;
    const lvl = this.levels.get(key) || { buy: 0, sell: 0 };
    if (side === 'buy') lvl.buy += size; else lvl.sell += size;
    this.levels.set(key, lvl);
    this.cumDelta += side === 'buy' ? size : -size;

    this.sizes.push(size);
    if (this.sizes.length > this.maxSizes) this.sizes.shift();

    const med = this._median();
    const mult = med > 0 ? size / med : 1;
    return { big: mult >= BIG_PRINT_MULT && this.sizes.length > 20, mult, side };
  }

  _median() {
    if (!this.sizes.length) return 0;
    const s = [...this.sizes].sort((a, b) => a - b);
    return s[s.length >> 1];
  }
}

// Market wraps a raw tick source (sim or ibkr) and turns the firehose of
// prints into the per-instrument *state* the game renders from: last price,
// session change, trade intensity (prints/sec), order-flow delta, and a 0..1
// `mood` that the pits read to drive shouting, colour and animation.
//
// It re-emits two high-level events:
//   'tick'     -> { symbol, price, size, side, state }
//   'bigPrint' -> { symbol, side, mult, price, state }
export class Market extends Emitter {
  constructor(source, pits) {
    super();
    this.source = source;
    this.state = new Map();
    for (const p of pits) {
      this.state.set(p.symbol, {
        symbol: p.symbol, name: p.name, tickSize: p.tickSize, hot: p.hot,
        last: p.basePrice, open: p.basePrice, prev: p.basePrice,
        change: 0, dir: 0, volume: 0, rate: 0, delta: 0,
        intensity: 0, mood: 0, shout: 0, flash: 0, flashDir: 0,
        _fp: new FootprintEngine(p.tickSize), _stamps: [],
      });
    }
    source.on('tick', (t) => this._onTick(t));
  }

  start() { this.source.start(); }
  stop() { this.source.stop?.(); }
  get connection() { return this.source.connection; }

  _onTick(t) {
    const s = this.state.get(t.symbol);
    if (!s) return;
    const now = t.time ?? performance.now();

    // Infer aggressor side with the tick rule when the feed doesn't supply it.
    let side = t.side;
    if (!side) side = t.price > s.last ? 'buy' : t.price < s.last ? 'sell' : (s.dir >= 0 ? 'buy' : 'sell');

    s.prev = s.last;
    s.last = t.price;
    s.dir = Math.sign(t.price - s.prev) || s.dir;
    s.change = s.last - s.open;
    s.volume += t.size;

    // Trade intensity: prints in the last second.
    s._stamps.push(now);
    const cutoff = now - 1000;
    while (s._stamps.length && s._stamps[0] < cutoff) s._stamps.shift();
    s.rate = s._stamps.length;

    const fp = s._fp.add(t.price, t.size, side);
    s.delta = s._fp.cumDelta;

    this.emit('tick', { symbol: t.symbol, price: t.price, size: t.size, side, state: s });

    if (fp.big) {
      const kick = clamp(fp.mult / 12, 0.35, 1);
      s.shout = Math.min(1, s.shout + kick);
      s.flash = 1;
      s.flashDir = side === 'buy' ? 1 : -1;
      this.emit('bigPrint', { symbol: t.symbol, side, mult: fp.mult, price: t.price, state: s });
    }
  }

  // Per-frame decay/smoothing of the derived mood signals. Called by the loop.
  update(dt) {
    for (const s of this.state.values()) {
      // Target intensity blends trade rate and recent volatility, scaled by the
      // instrument's "hot" temperament so the S&P pit runs hotter than bonds.
      const vol = Math.abs(s.last - s.prev) / s.tickSize;
      const target = clamp((s.rate / 14) * 0.7 + clamp(vol / 6, 0, 1) * 0.5, 0, 1) * s.hot;
      s.intensity += (clamp(target, 0, 1) - s.intensity) * Math.min(1, dt * 3);
      s.shout = Math.max(0, s.shout - dt * 0.55);
      s.flash = Math.max(0, s.flash - dt * 1.6);
      s.mood = clamp(s.intensity * 0.7 + s.shout * 0.6, 0, 1);
    }
  }
}
