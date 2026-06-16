import { Emitter } from '../util.js';

// Live tick source backed by Interactive Brokers.
//
// Browsers can't speak the IBKR TWS socket protocol directly, so this connects
// to the small Node bridge in server/ibkr-bridge.js over a WebSocket. The
// bridge subscribes to reqTickByTickData("AllLast") for each configured
// contract and forwards normalised JSON prints:
//
//   { type: 'tick', symbol, price, size, side?, time }
//
// If the bridge is unreachable the feed reports a 'down' connection status; the
// caller (main.js) can then fall back to the simulated feed.
export class IbkrFeed extends Emitter {
  constructor(pits, url) {
    super();
    this.pits = pits;
    this.url = url;
    this.connection = { kind: 'ibkr', status: 'connecting', url };
    this.ws = null;
    this._retry = 0;
    this._closed = false;
  }

  start() {
    this._closed = false;
    this._connect();
  }

  stop() {
    this._closed = true;
    this.ws?.close();
    this.connection.status = 'closed';
  }

  _connect() {
    this.connection.status = 'connecting';
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      return this._scheduleRetry();
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this._retry = 0;
      this.connection.status = 'live';
      // Tell the bridge which contracts we want.
      ws.send(JSON.stringify({
        type: 'subscribe',
        contracts: this.pits.map((p) => ({ symbol: p.symbol, ...p.ibkr })),
      }));
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'tick') {
        this.emit('tick', {
          symbol: msg.symbol,
          price: msg.price,
          size: msg.size ?? 1,
          side: msg.side,            // bridge may infer from bid/ask
          time: msg.time ?? performance.now(),
        });
      } else if (msg.type === 'status') {
        this.connection.detail = msg.detail;
      }
    });

    ws.addEventListener('close', () => { if (!this._closed) this._scheduleRetry(); });
    ws.addEventListener('error', () => { ws.close(); });
  }

  _scheduleRetry() {
    this.connection.status = 'down';
    if (this._closed) return;
    const delay = Math.min(16000, 1000 * 2 ** this._retry++);
    setTimeout(() => !this._closed && this._connect(), delay);
  }
}
