import { fmtPrice, clamp } from './util.js';

// Thin wrapper over the DOM HUD declared in index.html. Keeps the readout for
// whichever pit the player is standing nearest, a live connection badge, and
// pops a toast when a big footprint hits.
export class Hud {
  constructor({ onMute }) {
    this.el = {
      sym: document.getElementById('hud-sym'),
      name: document.getElementById('hud-name'),
      price: document.getElementById('hud-price'),
      change: document.getElementById('hud-change'),
      mood: document.getElementById('hud-mood-fill'),
      rate: document.getElementById('hud-rate'),
      delta: document.getElementById('hud-delta'),
      conn: document.getElementById('conn'),
      toast: document.getElementById('toast'),
      mute: document.getElementById('btn-mute'),
    };
    this.muted = false;
    this.el.mute.addEventListener('click', () => {
      this.muted = !this.muted;
      this.el.mute.classList.toggle('off', this.muted);
      this.el.mute.textContent = this.muted ? '🔇' : '🔊';
      onMute(this.muted);
    });
    this._toastT = 0;
  }

  setConnection(conn) {
    const map = {
      live: ['● LIVE', '#46d39a'], connecting: ['● CONNECTING', '#f2c14e'],
      down: ['● OFFLINE', '#ff6b6b'], closed: ['● CLOSED', '#888'],
    };
    const [txt, col] = map[conn.status] || ['● —', '#888'];
    const label = conn.kind === 'ibkr' ? 'IBKR' : 'SIM';
    this.el.conn.textContent = `${label}  ${txt}`;
    this.el.conn.style.color = col;
  }

  update(pit, s) {
    this.el.sym.textContent = s.symbol;
    this.el.sym.style.color = '#' + pit.color.getHexString();
    this.el.name.textContent = s.name;
    this.el.price.textContent = fmtPrice(s.last, s.tickSize);
    const up = s.change > 0, dn = s.change < 0;
    this.el.change.textContent = `${up ? '+' : ''}${s.change.toFixed(2)}`;
    this.el.change.style.color = up ? '#46d39a' : dn ? '#ff6b6b' : '#cfd';
    this.el.mood.style.width = `${clamp(s.mood, 0, 1) * 100}%`;
    this.el.mood.style.background = s.dir >= 0 ? '#46d39a' : '#ff6b6b';
    this.el.rate.textContent = `${s.rate}/s`;
    this.el.delta.textContent = (s.delta >= 0 ? '+' : '') + Math.round(s.delta);
    this.el.delta.style.color = s.delta >= 0 ? '#46d39a' : '#ff6b6b';
  }

  toast(symbol, side, mult) {
    const t = this.el.toast;
    const up = side === 'buy';
    t.innerHTML = `<b style="color:${up ? '#46ff9a' : '#ff6b6b'}">${symbol}</b> ` +
      `BLOCK ${up ? 'BID LIFTED ▲' : 'OFFER HIT ▼'} <span class="x">${mult.toFixed(1)}×</span>`;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 1400);
  }
}
