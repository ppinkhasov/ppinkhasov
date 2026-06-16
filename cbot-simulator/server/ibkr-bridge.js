// CBOT simulator — Interactive Brokers → WebSocket bridge.
//
// The browser game can't speak the IBKR TWS socket protocol, so this small Node
// process sits in the middle: it connects to a running TWS / IB Gateway,
// resolves the front-month future for each requested contract, subscribes to
// tick-by-tick "AllLast" trades, and forwards each print to the browser as JSON
// over a WebSocket.
//
//   browser (IbkrFeed)  ⇄  ws://localhost:8080  ⇄  this bridge  ⇄  TWS :7497
//
// Setup:
//   1. Install + run IB Gateway or TWS and enable the API
//      (Configure ▸ API ▸ Settings ▸ "Enable ActiveX and Socket Clients").
//      Paper trading uses port 7497; live uses 7496.
//   2. npm install            (from this server/ directory)
//   3. npm start              (or: IB_PORT=7497 WS_PORT=8080 node ibkr-bridge.js)
//   4. open the game with     ?feed=ibkr&bridge=ws://localhost:8080
//
// Market data for the relevant exchanges (CBOT/CME) must be enabled on the
// account, otherwise IBKR returns delayed or no ticks.

import { WebSocketServer } from 'ws';
import { IBApi, EventName, Contract } from '@stoqey/ib';

const IB_HOST = process.env.IB_HOST || '127.0.0.1';
const IB_PORT = Number(process.env.IB_PORT || 7497);   // 7497 paper, 7496 live
const CLIENT_ID = Number(process.env.IB_CLIENT_ID || 17);
const WS_PORT = Number(process.env.WS_PORT || 8080);

const ib = new IBApi({ host: IB_HOST, port: IB_PORT, clientId: CLIENT_ID });

let reqSeq = 1;
const nextId = () => reqSeq++;

// reqId -> { symbol } so we can label incoming ticks
const tickReqs = new Map();
// reqId -> resolver for contract-details lookups
const detailWaiters = new Map();
// symbol -> last bid/ask, used to infer trade aggressor side
const quotes = new Map();

const clients = new Set();
function broadcast(obj) {
  const json = JSON.stringify(obj);
  for (const ws of clients) if (ws.readyState === 1) ws.send(json);
}

// ---- IB event wiring ----
ib.on(EventName.connected, () => console.log(`[bridge] connected to IB at ${IB_HOST}:${IB_PORT}`));
ib.on(EventName.disconnected, () => console.log('[bridge] disconnected from IB'));
ib.on(EventName.error, (err, code, reqId) => {
  // 2104/2106/2158 are benign "market data farm OK" notices
  if ([2104, 2106, 2158, 2107].includes(code)) return;
  console.warn(`[bridge] IB error ${code} (req ${reqId}): ${err?.message || err}`);
});

ib.on(EventName.contractDetails, (reqId, details) => {
  const w = detailWaiters.get(reqId);
  if (w) w.results.push(details.contract);
});
ib.on(EventName.contractDetailsEnd, (reqId) => {
  const w = detailWaiters.get(reqId);
  if (!w) return;
  detailWaiters.delete(reqId);
  w.resolve(w.results);
});

// tick-by-tick last trades
ib.on(EventName.tickByTickAllLast, (reqId, _type, time, price, size) => {
  const meta = tickReqs.get(reqId);
  if (!meta || !price) return;
  const q = quotes.get(meta.symbol);
  let side;
  if (q) side = price >= q.ask ? 'buy' : price <= q.bid ? 'sell' : undefined;
  broadcast({ type: 'tick', symbol: meta.symbol, price, size: Number(size) || 1, side, time: Date.now() });
});

// track best bid/ask so we can label aggressor side
ib.on(EventName.tickPrice, (reqId, field, value) => {
  const meta = tickReqs.get(reqId - 100000); // quote reqs are offset (see below)
  if (!meta) return;
  const q = quotes.get(meta.symbol) || {};
  if (field === 1) q.bid = value;      // BID
  if (field === 2) q.ask = value;      // ASK
  quotes.set(meta.symbol, q);
});

// resolve the front (nearest-expiry) contract for a future
function resolveFrontMonth(spec) {
  return new Promise((resolve) => {
    const reqId = nextId();
    const c = Object.assign(new Contract(), {
      symbol: spec.symbol, secType: spec.secType || 'FUT',
      exchange: spec.exchange, currency: spec.currency || 'USD',
    });
    if (spec.lastTradeDateOrContractMonth) c.lastTradeDateOrContractMonth = spec.lastTradeDateOrContractMonth;
    detailWaiters.set(reqId, { results: [], resolve });
    ib.reqContractDetails(reqId, c);
    setTimeout(() => { if (detailWaiters.has(reqId)) { detailWaiters.delete(reqId); resolve([]); } }, 5000);
  });
}

async function subscribeContract(spec) {
  const matches = await resolveFrontMonth(spec);
  // pick the earliest expiry that hasn't passed
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const front = matches
    .map((c) => c)
    .filter((c) => (c.lastTradeDateOrContractMonth || '99999999') >= today)
    .sort((a, b) => (a.lastTradeDateOrContractMonth > b.lastTradeDateOrContractMonth ? 1 : -1))[0];

  if (!front) {
    console.warn(`[bridge] no contract found for ${spec.symbol}`);
    broadcast({ type: 'status', detail: `no contract for ${spec.symbol}` });
    return;
  }
  console.log(`[bridge] ${spec.symbol} -> ${front.localSymbol || front.lastTradeDateOrContractMonth}`);

  // trades
  const tickId = nextId();
  tickReqs.set(tickId, { symbol: spec.symbol });
  ib.reqTickByTickData(tickId, front, 'AllLast', 0, false);

  // a parallel quote stream (offset reqId) so we can infer aggressor side
  const quoteId = tickId + 100000;
  tickReqs.set(quoteId - 100000, { symbol: spec.symbol }); // map back in tickPrice
  ib.reqMktData(quoteId, front, '', false, false);
}

// ---- WebSocket server facing the browser ----
const wss = new WebSocketServer({ port: WS_PORT });
console.log(`[bridge] websocket listening on ws://localhost:${WS_PORT}`);

let subscribed = false;
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[bridge] browser connected (${clients.size} total)`);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'subscribe' && !subscribed) {
      subscribed = true;
      for (const spec of msg.contracts) {
        try { await subscribeContract(spec); } catch (e) { console.warn('[bridge]', e.message); }
      }
    }
  });
});

ib.connect();
process.on('SIGINT', () => { ib.disconnect(); process.exit(0); });
