import { Emitter, rand } from '../util.js';

// Built-in simulated tick source. Produces a believable-enough order flow for
// each instrument without any external connection, so the game runs anywhere
// (including a static GitHub Pages deploy). Each instrument is an independent
// mean-reverting random walk that drifts in and out of "active" regimes and
// occasionally fires an outsized block print — which the FootprintEngine then
// flags as a big footprint.
export class SimFeed extends Emitter {
  constructor(pits) {
    super();
    this.connection = { kind: 'sim', status: 'live' };
    this.books = pits.map((p) => ({
      symbol: p.symbol,
      price: p.basePrice,
      tickSize: p.tickSize,
      vol: p.vol,
      hot: p.hot,
      drift: 0,
      next: 0,          // ms until next print
      regime: 0,        // 0 calm .. 1 frantic
      regimeLeft: rand(4000, 12000),
    }));
    this._raf = 0;
    this._last = 0;
  }

  start() {
    this.connection.status = 'live';
    this._last = performance.now();
    const loop = (now) => {
      const dt = now - this._last;
      this._last = now;
      for (const b of this.books) this._step(b, dt, now);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this._raf); this.connection.status = 'closed'; }

  _step(b, dt, now) {
    // Regime switching: occasionally flip between quiet and frantic trading.
    b.regimeLeft -= dt;
    if (b.regimeLeft <= 0) {
      b.regime = Math.random() < 0.45 ? rand(0.6, 1) : rand(0, 0.3);
      b.regimeLeft = rand(3000, 14000);
      b.drift = rand(-1, 1) * b.regime; // directional bias during the regime
    }

    b.next -= dt;
    if (b.next > 0) return;
    // Faster prints when the regime is hot.
    b.next = rand(40, 320) * (1 - b.regime * 0.8);

    // Price step: mean-reverting walk plus regime drift, quantised to ticks.
    if (b._anchor === undefined) b._anchor = b.price;     // session reference
    const reversion = (b._anchor - b.price) * 0.0002;
    const step = (rand(-1, 1) * b.vol + b.drift * b.vol * 0.6) * b.tickSize;
    b.price = Math.max(b.tickSize, b.price + step + reversion);
    b.price = Math.round(b.price / b.tickSize) * b.tickSize;

    // Size: mostly small lots, with a fat tail. Hot regimes throw blocks.
    let size = Math.max(1, Math.round(Math.abs(rand(0, 1) ** 3 * 18) + 1));
    if (Math.random() < 0.015 + b.regime * 0.05) size += Math.round(rand(40, 260) * b.hot);

    const side = step > 0 ? 'buy' : step < 0 ? 'sell' : (Math.random() < 0.5 ? 'buy' : 'sell');
    this.emit('tick', { symbol: b.symbol, price: b.price, size, side, time: now });
  }
}
