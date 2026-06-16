# CBOT — Open Outcry

A web-based **Chicago Board of Trade trading-pit simulator**. Run a little
backpacked character around the floor between open-outcry pits — bonds, notes,
the grains, the S&P — while the crowds **change their mood, colour, hand-signals
and roar** in response to live market data. Tick velocity drives the energy of
each pit; **big footprints** (outsized block prints) make the pit *erupt* with a
green/red bloom flash and a shout.

Built with **Three.js / WebGL**, no build step. The art direction is a cozy,
cel-shaded, seafoam-lit nod to [Messenger](https://messenger.abeto.co) — toon
shading, soft vignette, third-person follow camera, minimal docked UI.

> It runs out of the box on a **simulated feed**, and can hook up to **live
> Interactive Brokers** data via a small local bridge.

## Run it

It's plain ES modules + an import map (Three.js from a CDN), so just serve the
folder over HTTP:

```bash
cd cbot-simulator
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` via `file://` won't work because of ES-module CORS — use a
local server, or deploy the folder to any static host / GitHub Pages.)

### Controls

| | |
|---|---|
| **W A S D** / arrows | run |
| **Shift** | sprint |
| drag (mouse / touch) | orbit camera |
| scroll | zoom |
| 🔊 button | mute |

Walk up to a pit to make it the "focused" instrument — the top-left panel and
the audio roar follow whichever pit you're nearest.

## How the market drives the floor

```
feed (sim | ibkr) ──ticks──▶ Market ──▶ FootprintEngine
                                │            │
                                │            └─ big-print detection (size ≥ N× median)
                                ▼
                    per-pit state: last, change, prints/sec,
                    order-flow delta, intensity, mood, shout, flash
                                │
              ┌─────────────────┼───────────────────┐
              ▼                 ▼                   ▼
         trader crowd      pit lighting +       audio roar /
         hand-signals       ticker board        shout / bell
```

- **Mood** blends trade rate and short-term volatility, scaled by each
  instrument's "temperament" (the S&P pit runs hotter than bonds).
- **Big footprint** = a print whose size is ≥ `BIG_PRINT_MULT` × the rolling
  median print size → shout burst, arms up, bloom flash, HUD toast.
- **Order-flow delta** (cumulative buy − sell volume) shows on each ticker board.

Tunable via URL query: `?big=8` (block threshold), `?feed=ibkr`, `?bridge=...`.

## Live Interactive Brokers data (optional)

Browsers can't speak the IBKR TWS socket protocol, so a tiny Node bridge
(`server/ibkr-bridge.js`) connects to **TWS / IB Gateway**, resolves the
front-month future for each instrument, subscribes to tick-by-tick `AllLast`
trades, and forwards them to the browser over a WebSocket.

```bash
# 1. In TWS / IB Gateway: Configure ▸ API ▸ Settings ▸ enable socket clients.
#    Paper trading listens on 7497, live on 7496.
cd cbot-simulator/server
npm install
IB_PORT=7497 WS_PORT=8080 npm start

# 2. Open the game pointed at the bridge:
#    http://localhost:8000/?feed=ibkr&bridge=ws://localhost:8080
```

If the bridge is unreachable, the game logs a warning and **falls back to the
simulated feed** automatically, so you always get a floor to walk around.

Instruments and their IBKR contract specs live in `src/config.js` — edit the
`PITS` array to add/retune pits (CBOT bonds/grains, CME for the E-mini, etc.).
You need the corresponding market-data subscriptions on your IBKR account for
live ticks; otherwise IBKR returns delayed/empty data.

## Layout

```
cbot-simulator/
├── index.html            # shell: import map, HUD, vignette, start overlay
├── src/
│   ├── main.js           # wires feed → world → player → audio → HUD; game loop
│   ├── config.js         # PITS (instruments + IBKR contracts), feed selection
│   ├── world.js          # hall, pits, ticker boards, mood lighting
│   ├── player.js         # third-person runner + follow camera
│   ├── traders.js        # the jacketed crowd + hand-signal animation
│   ├── audio.js          # synthesized roar / shout / bell (no asset files)
│   ├── hud.js            # DOM HUD + big-print toast
│   ├── util.js           # toon shading helpers, math, price formatting
│   └── market/
│       ├── feed.js       # Market aggregator + FootprintEngine
│       ├── sim.js        # built-in simulated tick source
│       └── ibkr.js       # WebSocket client for the IBKR bridge
└── server/
    ├── ibkr-bridge.js    # TWS tick-by-tick → WebSocket bridge
    └── package.json
```

*Disclaimer: a toy/visualization for fun and education — not a trading tool, and
not affiliated with CME Group or Interactive Brokers.*
