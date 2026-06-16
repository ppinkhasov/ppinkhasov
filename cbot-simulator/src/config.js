// Pit / instrument configuration for the CBOT trading floor.
//
// Each pit is one open-outcry trading pit on the floor. `symbol` is what the
// HUD and ticker boards display; `ibkr` carries the contract fields the Node
// bridge (server/ibkr-bridge.js) needs to subscribe to live tick-by-tick data.
//
// `tickSize` is the minimum price increment, `basePrice` seeds the simulator,
// and `vol` is a rough per-tick volatility used only by the simulated feed.
// `pos` is the pit's [x, z] location on the floor (y is the floor plane).

export const PITS = [
  {
    id: 'ZB', symbol: 'ZB', name: '30-Year T-Bond',
    color: 0x4fa3ff, basePrice: 118.5, tickSize: 1 / 32, vol: 0.9, hot: 1.2,
    pos: [-15, 0, -13],
    ibkr: { symbol: 'ZB', secType: 'FUT', exchange: 'CBOT', currency: 'USD', lastTradeDateOrContractMonth: '' },
  },
  {
    id: 'ZN', symbol: 'ZN', name: '10-Year T-Note',
    color: 0x46d39a, basePrice: 110.2, tickSize: 1 / 64, vol: 0.6, hot: 1.0,
    pos: [0, 0, -19],
    ibkr: { symbol: 'ZN', secType: 'FUT', exchange: 'CBOT', currency: 'USD', lastTradeDateOrContractMonth: '' },
  },
  {
    id: 'ZC', symbol: 'ZC', name: 'Corn',
    color: 0xf2c14e, basePrice: 445.25, tickSize: 0.25, vol: 1.4, hot: 1.4,
    pos: [15, 0, -13],
    ibkr: { symbol: 'ZC', secType: 'FUT', exchange: 'CBOT', currency: 'USD', lastTradeDateOrContractMonth: '' },
  },
  {
    id: 'ZS', symbol: 'ZS', name: 'Soybeans',
    color: 0x8bd24f, basePrice: 1185.5, tickSize: 0.25, vol: 2.2, hot: 1.6,
    pos: [-15, 0, 13],
    ibkr: { symbol: 'ZS', secType: 'FUT', exchange: 'CBOT', currency: 'USD', lastTradeDateOrContractMonth: '' },
  },
  {
    id: 'ZW', symbol: 'ZW', name: 'Wheat',
    color: 0xe07a5f, basePrice: 612.75, tickSize: 0.25, vol: 1.8, hot: 1.5,
    pos: [0, 0, 19],
    ibkr: { symbol: 'ZW', secType: 'FUT', exchange: 'CBOT', currency: 'USD', lastTradeDateOrContractMonth: '' },
  },
  {
    id: 'ES', symbol: 'ES', name: 'E-mini S&P 500',
    color: 0xb588ff, basePrice: 5280.0, tickSize: 0.25, vol: 2.6, hot: 1.8,
    pos: [15, 0, 13],
    ibkr: { symbol: 'ES', secType: 'FUT', exchange: 'CME', currency: 'USD', lastTradeDateOrContractMonth: '' },
  },
];

// Feed selection: 'sim' (built-in random-walk feed, works anywhere) or
// 'ibkr' (connect to the local bridge). Override at runtime with the URL query
// string, e.g. ?feed=ibkr&bridge=ws://localhost:8080
const params = new URLSearchParams(location.search);

export const FEED = {
  kind: params.get('feed') || 'sim',
  bridgeUrl: params.get('bridge') || 'ws://localhost:8080',
};

// A "big footprint" is a print whose size is at least this multiple of the
// recent median print size for that instrument. Tunable from the URL too.
export const BIG_PRINT_MULT = Number(params.get('big') || 6);
