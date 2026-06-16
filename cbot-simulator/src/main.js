import * as THREE from 'three';
import { PITS, FEED } from './config.js';
import { Market } from './market/feed.js';
import { SimFeed } from './market/sim.js';
import { IbkrFeed } from './market/ibkr.js';
import { World } from './world.js';
import { Player } from './player.js';
import { AudioEngine } from './audio.js';
import { Hud } from './hud.js';

// --- market feed (sim by default; IBKR bridge when requested) ---
let source;
if (FEED.kind === 'ibkr') {
  source = new IbkrFeed(PITS, FEED.bridgeUrl);
  // If the bridge never comes up, transparently fall back to the simulator.
  setTimeout(() => {
    if (source.connection.status !== 'live') {
      console.warn('[CBOT] IBKR bridge unreachable — falling back to sim feed');
      market.source = source = swapToSim();
    }
  }, 6000);
} else {
  source = new SimFeed(PITS);
}
function swapToSim() { const s = new SimFeed(PITS); market._wire(s); s.start(); return s; }

const market = new Market(source, PITS);
// allow hot-swapping the source after construction (used by the fallback)
market._wire = (s) => { s.on('tick', (t) => market._onTick(t)); };

// --- 3d world + player ---
const canvas = document.getElementById('game');
const world = new World(canvas, PITS);
const colliders = world.pits.map((p) => ({ pos: p.worldPos, radius: 7.2 }));
const player = new Player(world.camera, colliders);
world.scene.add(player.group);

// --- audio + hud ---
const audio = new AudioEngine();
const hud = new Hud({ onMute: (m) => audio.setMuted(m) });
hud.setConnection(market.connection);

// big footprints → toast + shout, but only really shout if you're nearby
market.on('bigPrint', ({ symbol, side, mult }) => {
  const { pit, dist } = world.nearest(player.pos);
  hud.toast(symbol, side, mult);
  if (pit?.cfg.symbol === symbol || dist < 16) {
    audio.shout(side === 'buy' ? 1 : -1, clamp(mult / 8, 0.4, 1.4));
  }
});

// start everything on first interaction (browsers gate audio on a gesture)
function begin() {
  audio.resume();
  audio.bell();           // ring the open
  document.getElementById('start')?.classList.add('hidden');
  removeEventListener('pointerdown', begin);
  removeEventListener('keydown', begin);
}
addEventListener('pointerdown', begin);
addEventListener('keydown', begin);

market.start();

// --- main loop ---
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  market.update(dt);
  player.update(dt, time);

  const { pit } = world.nearest(player.pos);
  const near = market.state.get(pit.cfg.symbol);
  world.update(market, time, dt, near);
  audio.update(near.mood, near.dir);

  hud.update(pit, near);
  hud.setConnection(market.connection);

  world.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
