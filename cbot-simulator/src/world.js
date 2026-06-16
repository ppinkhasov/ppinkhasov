import * as THREE from 'three';
import { toon, fmtPrice, clamp, lerp, damp } from './util.js';
import { placeTraders } from './traders.js';

const TEAL = 0x86d9c9;        // the Messenger-style seafoam skylight
const SKY = 0x9fe3d6;
const WOOD = 0x7a5630;
const CREAM = 0xe9dcb8;

// One trading pit: a raised octagonal dais ringed by traders in loud jackets,
// a central instrument pillar, and a four-sided ticker board overhead. It owns
// a coloured light that brightens and shifts green/red with order flow, and a
// bloom sprite that flashes on big footprints.
class Pit {
  constructor(cfg) {
    this.cfg = cfg;
    this.group = new THREE.Group();
    this.group.position.set(cfg.pos[0], 0, cfg.pos[2]);
    this.worldPos = new THREE.Vector3(cfg.pos[0], 0, cfg.pos[2]);
    this.color = new THREE.Color(cfg.color);
    this._lastBoard = 0;
    this._build();
  }

  _build() {
    const R = 6;
    // stepped dais — a couple of stadium tiers so the crowd reads as a "pit"
    const tierMat = toon(0x4a4a52);
    for (let i = 0; i < 3; i++) {
      const r = R - i * 1.2;
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.3, 0.35, 8), tierMat);
      tier.position.y = 0.17 + i * 0.34;
      tier.rotation.y = Math.PI / 8;
      tier.receiveShadow = true; tier.castShadow = true;
      this.group.add(tier);
    }
    // brass rail around the rim
    const rail = new THREE.Mesh(new THREE.TorusGeometry(R + 0.25, 0.06, 6, 8), toon(0xc8a24a));
    rail.rotation.x = Math.PI / 2; rail.rotation.z = Math.PI / 8;
    rail.position.y = 1.2; this.group.add(rail);

    // central instrument pillar
    this.pillarMat = toon(this.cfg.color, { emissive: this.color.clone().multiplyScalar(0.2) });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 2.4, 8), this.pillarMat);
    pillar.position.y = 2.2; pillar.castShadow = true; this.group.add(pillar);

    // ticker board: a 4-sided box so it's readable from any approach
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 512; this.boardCanvas.height = 256;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const boardMat = new THREE.MeshBasicMaterial({ map: this.boardTex });
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.1, 4.2), boardMat);
    board.position.y = 4.8; this.group.add(board);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 8), toon(0x333));
    mast.position.y = 3.6; this.group.add(mast);

    // mood light + bloom flash
    this.light = new THREE.PointLight(this.cfg.color, 6, 26, 2);
    this.light.position.y = 3; this.group.add(this.light);
    const glowTex = makeGlow();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.glow.scale.set(10, 10, 1); this.glow.position.y = 3; this.group.add(this.glow);

    // the crowd
    this.traders = placeTraders(16, R + 0.6);
    for (const t of this.traders) this.group.add(t.group);

    this.drawBoard({ last: this.cfg.basePrice, change: 0, dir: 0, volume: 0, delta: 0, rate: 0 });
  }

  drawBoard(s) {
    const c = this.boardCanvas.getContext('2d');
    c.fillStyle = '#0c0f0e'; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#1a1f1d'; c.fillRect(8, 8, 496, 240);
    // header
    c.fillStyle = '#' + this.color.getHexString();
    c.font = 'bold 64px monospace'; c.textBaseline = 'top';
    c.fillText(this.cfg.symbol, 24, 18);
    c.fillStyle = '#9aa'; c.font = '20px sans-serif';
    c.fillText(this.cfg.name, 26, 82);
    // last price
    const up = s.change > 0, dn = s.change < 0;
    c.fillStyle = up ? '#46d39a' : dn ? '#ff6b6b' : '#e8e8e8';
    c.font = 'bold 76px monospace';
    c.textAlign = 'right';
    c.fillText(fmtPrice(s.last, this.cfg.tickSize), 488, 110);
    // change
    c.font = 'bold 30px monospace';
    const sign = s.change > 0 ? '+' : '';
    c.fillText(`${sign}${(s.change).toFixed(2)}`, 488, 196);
    c.textAlign = 'left';
    // order-flow delta bar
    c.fillStyle = '#333'; c.fillRect(26, 200, 220, 22);
    const d = clamp(s.delta / 4000, -1, 1);
    c.fillStyle = d >= 0 ? '#46d39a' : '#ff6b6b';
    c.fillRect(136, 200, d * 110, 22);
    c.fillStyle = '#778'; c.font = '16px sans-serif';
    c.fillText('DELTA', 26, 224);
    this.boardTex.needsUpdate = true;
  }

  react(state, time, dt) {
    const s = state;
    for (const t of this.traders) t.update(time, s.mood, s.dir, s.shout);

    // light brightens with mood, tints green/red with flash direction
    this.light.intensity = damp(this.light.intensity, 3 + s.mood * 7 + s.flash * 10, 6, dt);
    const tint = new THREE.Color(this.cfg.color);
    if (s.flash > 0.01) tint.lerp(new THREE.Color(s.flashDir > 0 ? 0x46ff9a : 0xff4d4d), clamp(s.flash, 0, 0.85));
    this.light.color.lerp(tint, clamp(dt * 8, 0, 1));

    // pillar glows with mood
    this.pillarMat.emissive.copy(this.color).multiplyScalar(0.15 + s.mood * 0.5 + s.flash * 0.6);

    // bloom flash on big prints
    this.glow.material.color.set(s.flashDir > 0 ? 0x46ff9a : 0xff5d5d);
    this.glow.material.opacity = damp(this.glow.material.opacity, s.flash * 0.8, 10, dt);
    this.glow.scale.setScalar(lerp(8, 16, s.flash));

    // refresh the board ~12x/sec
    if (time - this._lastBoard > 0.08) { this.drawBoard(s); this._lastBoard = time; }
  }
}

export class World {
  constructor(canvas, pits) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 55, 150);

    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);
    this.camera.position.set(0, 6, 18);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._buildHall();

    this.pits = pits.map((c) => new Pit(c));
    for (const p of this.pits) this.scene.add(p.group);

    addEventListener('resize', () => this._resize());
  }

  _buildHall() {
    // warm/teal two-tone toon lighting: cool skylight from above, warm bounce
    const hemi = new THREE.HemisphereLight(TEAL, 0xc89a5a, 1.35);
    this.scene.add(hemi);
    this.skyLight = hemi;
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.5);
    sun.position.set(20, 40, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 140;
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xeafaf4, 0.5));

    // parquet floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(110, 110),
      new THREE.MeshToonMaterial({ map: makeWood() }),
    );
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.scene.add(floor);

    // perimeter walls with glowing teal "windows"
    const wallMat = toon(CREAM);
    const winMat = new THREE.MeshBasicMaterial({ color: 0xbff3e8 });
    const H = 22, S = 55;
    const walls = [
      [0, H / 2, -S, 0], [0, H / 2, S, Math.PI],
      [-S, H / 2, 0, Math.PI / 2], [S, H / 2, 0, -Math.PI / 2],
    ];
    for (const [x, y, z, ry] of walls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(110, H, 1), wallMat);
      wall.position.set(x, y, z); wall.rotation.y = ry; wall.receiveShadow = true;
      this.scene.add(wall);
      // a row of tall arched-ish windows
      for (let i = -4; i <= 4; i++) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(6, 12), winMat);
        w.position.set(x + Math.cos(ry) * (i * 11), 12, z + Math.sin(ry) * (i * 11) + (z === 0 ? 0 : 0));
        // offset slightly inside the wall plane
        const n = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(z < 0 || x < 0 ? 0.6 : -0.6);
        w.position.add(n);
        w.rotation.y = ry + (z > 0 || x > 0 ? Math.PI : 0);
        this.scene.add(w);
      }
    }

    // soft skylight ceiling glow
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(110, 110),
      new THREE.MeshBasicMaterial({ color: 0xdff6ef }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 22; this.scene.add(ceil);
  }

  // nearest pit to a world position, with distance.
  nearest(pos) {
    let best = null, bd = Infinity;
    for (const p of this.pits) {
      const d = p.worldPos.distanceTo(pos);
      if (d < bd) { bd = d; best = p; }
    }
    return { pit: best, dist: bd };
  }

  update(market, time, dt, nearestState) {
    for (const p of this.pits) p.react(market.state.get(p.cfg.symbol), time, dt);
    // global skylight warms on rallies, cools on sell-offs near the player
    if (nearestState) {
      const warm = new THREE.Color(TEAL);
      if (nearestState.dir > 0) warm.lerp(new THREE.Color(0xfff0c0), nearestState.mood * 0.5);
      else if (nearestState.dir < 0) warm.lerp(new THREE.Color(0xff9a9a), nearestState.mood * 0.4);
      this.skyLight.color.lerp(warm, clamp(dt * 2, 0, 1));
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }

  _resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
}

// ---- small procedural textures (no asset files) ----
function makeWood() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = '#a8794a'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 16) {
    x.fillStyle = i % 32 === 0 ? '#9a6c3f' : '#b98a55';
    x.fillRect(0, i, 256, 14);
    x.strokeStyle = 'rgba(0,0,0,0.12)'; x.strokeRect(0, i, 256, 14);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 24);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeGlow() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}
