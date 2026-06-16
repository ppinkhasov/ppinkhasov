import * as THREE from 'three';
import { toon, fmtPrice, clamp, lerp, damp } from './util.js';
import { placeTraders } from './traders.js';
import { outlineAll, makeSky, makeDust, makeShaft, makeComposer } from './fx.js';

const TEAL = 0x86d9c9;        // the Messenger-style seafoam skylight
const WOOD = 0xa8794a;
const CREAM = 0xe9dcb8;
const STONE = 0xd8cba6;

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
    const shell = new THREE.Group();   // everything that should get an ink outline
    // stepped dais — a couple of stadium tiers so the crowd reads as a "pit"
    for (let i = 0; i < 3; i++) {
      const r = R - i * 1.2;
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.3, 0.35, 8),
        toon(i === 0 ? 0x6b5640 : 0x55463a));
      tier.position.y = 0.17 + i * 0.34;
      tier.rotation.y = Math.PI / 8;
      tier.receiveShadow = true; tier.castShadow = true;
      shell.add(tier);
    }
    // brass rail around the rim
    const rail = new THREE.Mesh(new THREE.TorusGeometry(R + 0.25, 0.07, 8, 8), toon(0xe0b24a));
    rail.rotation.x = Math.PI / 2; rail.rotation.z = Math.PI / 8;
    rail.position.y = 1.2; shell.add(rail);

    // central instrument pillar
    this.pillarMat = toon(this.cfg.color, { emissive: this.color.clone().multiplyScalar(0.2) });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 2.4, 8), this.pillarMat);
    pillar.position.y = 2.2; pillar.castShadow = true; shell.add(pillar);

    this.traders = placeTraders(14, R + 0.6);
    for (const t of this.traders) shell.add(t.group);

    outlineAll(shell, 0.035);
    this.group.add(shell);

    // ticker board: a 4-sided box so it's readable from any approach
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 512; this.boardCanvas.height = 256;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const boardMat = new THREE.MeshBasicMaterial({ map: this.boardTex });
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.1, 4.2), boardMat);
    board.position.y = 4.8; this.group.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.3, 4.4), toon(0x20262a));
    frame.position.y = 4.8; frame.scale.multiplyScalar(0.999); this.group.add(frame);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 8), toon(0x2a2a2a));
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

    this.drawBoard({ last: this.cfg.basePrice, change: 0, dir: 0, volume: 0, delta: 0, rate: 0 });
  }

  drawBoard(s) {
    const c = this.boardCanvas.getContext('2d');
    c.fillStyle = '#0c0f0e'; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#1a1f1d'; c.fillRect(8, 8, 496, 240);
    c.fillStyle = '#' + this.color.getHexString();
    c.font = 'bold 64px monospace'; c.textBaseline = 'top';
    c.fillText(this.cfg.symbol, 24, 18);
    c.fillStyle = '#9aa'; c.font = '20px sans-serif';
    c.fillText(this.cfg.name, 26, 82);
    const up = s.change > 0, dn = s.change < 0;
    c.fillStyle = up ? '#7dffc0' : dn ? '#ff8a8a' : '#e8e8e8';
    c.font = 'bold 76px monospace'; c.textAlign = 'right';
    c.fillText(fmtPrice(s.last, this.cfg.tickSize), 488, 110);
    c.font = 'bold 30px monospace';
    c.fillText(`${s.change > 0 ? '+' : ''}${s.change.toFixed(2)}`, 488, 196);
    c.textAlign = 'left';
    c.fillStyle = '#333'; c.fillRect(26, 200, 220, 22);
    const d = clamp(s.delta / 4000, -1, 1);
    c.fillStyle = d >= 0 ? '#46d39a' : '#ff6b6b';
    c.fillRect(136, 200, d * 110, 22);
    c.fillStyle = '#778'; c.font = '16px sans-serif';
    c.fillText('DELTA', 26, 224);
    this.boardTex.needsUpdate = true;
  }

  react(s, time, dt) {
    for (const t of this.traders) t.update(time, s.mood, s.dir, s.shout);
    this.light.intensity = damp(this.light.intensity, 3 + s.mood * 7 + s.flash * 10, 6, dt);
    const tint = new THREE.Color(this.cfg.color);
    if (s.flash > 0.01) tint.lerp(new THREE.Color(s.flashDir > 0 ? 0x46ff9a : 0xff4d4d), clamp(s.flash, 0, 0.85));
    this.light.color.lerp(tint, clamp(dt * 8, 0, 1));
    this.pillarMat.emissive.copy(this.color).multiplyScalar(0.15 + s.mood * 0.5 + s.flash * 0.6);
    this.glow.material.color.set(s.flashDir > 0 ? 0x46ff9a : 0xff5d5d);
    this.glow.material.opacity = damp(this.glow.material.opacity, s.flash * 0.85, 10, dt);
    this.glow.scale.setScalar(lerp(8, 18, s.flash));
    if (time - this._lastBoard > 0.08) { this.drawBoard(s); this._lastBoard = time; }
  }
}

export class World {
  constructor(canvas, pits) {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd6ece2, 0.0085);

    this.camera = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.1, 500);
    this.camera.position.set(0, 6, 18);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.add(makeSky());
    this.dust = makeDust(800, 100, 22);
    this.scene.add(this.dust);

    this._buildHall();
    this._buildMasterBoard();

    this.pits = pits.map((c) => new Pit(c));
    for (const p of this.pits) this.scene.add(p.group);

    const fx = makeComposer(this.renderer, this.scene, this.camera);
    this.composer = fx.composer; this.bloom = fx.bloom;

    addEventListener('resize', () => this._resize());
  }

  _buildHall() {
    const hemi = new THREE.HemisphereLight(TEAL, 0xc89a5a, 1.15);
    this.scene.add(hemi); this.skyLight = hemi;
    const sun = new THREE.DirectionalLight(0xfff1da, 1.7);
    sun.position.set(26, 46, 18); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xeafaf4, 0.45));

    // parquet floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
      new THREE.MeshToonMaterial({ map: makeWood() }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMat = toon(CREAM);
    const winMat = new THREE.MeshBasicMaterial({ color: 0xd6f8ee });
    const trimMat = toon(0xb89a5a);
    const H = 24, S = 56;
    const dirs = [
      [0, -S, 0], [0, S, Math.PI], [-S, 0, Math.PI / 2], [S, 0, -Math.PI / 2],
    ];
    for (const [x, z, ry] of dirs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(120, H, 1.2), wallMat);
      wall.position.set(x, H / 2, z); wall.rotation.y = ry; wall.receiveShadow = true;
      this.scene.add(wall);
      const along = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry)); // wall tangent
      const inward = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(-Math.sign(x + z) || -1);
      for (let i = -4; i <= 4; i++) {
        const base = new THREE.Vector3(x, 13, z).addScaledVector(along, i * 11.5);
        // tall window + arched glow
        const w = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 13), winMat);
        w.position.copy(base).addScaledVector(inward, 0.62); w.rotation.y = ry + Math.PI;
        this.scene.add(w);
        const arch = new THREE.Mesh(new THREE.CircleGeometry(3.2, 16, 0, Math.PI), winMat);
        arch.position.copy(base).addScaledVector(inward, 0.62); arch.position.y = 19.5; arch.rotation.y = ry + Math.PI;
        this.scene.add(arch);
        // a soft light shaft slanting in from each window
        const shaft = makeShaft(6, 30);
        shaft.position.copy(base).addScaledVector(inward, 6).setY(8);
        shaft.lookAt(base.x, 0, base.z); shaft.rotation.x += 0.5;
        this.scene.add(shaft);
      }
      // baseboard trim
      const trim = new THREE.Mesh(new THREE.BoxGeometry(120, 1.6, 1.4), trimMat);
      trim.position.set(x, 0.8, z).addScaledVector(inward, 0.2); trim.rotation.y = ry;
      this.scene.add(trim);
    }

    // coffered ceiling with glowing skylight strips
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), toon(0x6b5b44));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 24; this.scene.add(ceil);
    const skyStrip = new THREE.MeshBasicMaterial({ color: 0xeafff8 });
    for (let i = -2; i <= 2; i++) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(90, 4), skyStrip);
      strip.rotation.x = Math.PI / 2; strip.position.set(0, 23.8, i * 22); this.scene.add(strip);
    }
    const beamMat = toon(0x4a3f2e);
    for (let i = -2; i <= 2; i++) {
      const bx = new THREE.Mesh(new THREE.BoxGeometry(120, 1, 1.4), beamMat);
      bx.position.set(0, 23.4, i * 22); this.scene.add(bx);
      const bz = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 120), beamMat);
      bz.position.set(i * 22, 23.4, 0); this.scene.add(bz);
    }

    // stone columns around the room
    const colGeo = new THREE.CylinderGeometry(1.1, 1.3, 24, 12);
    const colMat = toon(STONE);
    const cols = new THREE.Group();
    for (const cx of [-44, 0, 44]) for (const cz of [-44, 0, 44]) {
      if (cx === 0 && cz === 0) continue;
      const col = new THREE.Mesh(colGeo, colMat);
      col.position.set(cx, 12, cz); col.castShadow = true; cols.add(col);
    }
    outlineAll(cols, 0.06); this.scene.add(cols);

    // hanging pendant lamps with warm pools of light
    for (const lx of [-22, 0, 22]) for (const lz of [-22, 0, 22]) {
      if (Math.abs(lx) + Math.abs(lz) === 0) continue;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 8, 6), toon(0x222));
      cord.position.set(lx, 19, lz); this.scene.add(cord);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1, 16, 1, true), toon(0x2b2b2b));
      shade.position.set(lx, 15, lz); this.scene.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe6ad }));
      bulb.position.set(lx, 14.7, lz); this.scene.add(bulb);
    }
    for (const [lx, lz] of [[-22, 0], [22, 0], [0, 22], [0, -22]]) {
      const pl = new THREE.PointLight(0xffe2a8, 1.2, 40, 2);
      pl.position.set(lx, 14, lz); this.scene.add(pl);
    }

    // perimeter clerk booths
    const booths = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const ry = i * Math.PI / 2;
      const inward = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      for (let j = -3; j <= 3; j++) {
        const along = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
        const p = new THREE.Vector3().addScaledVector(inward, 49).addScaledVector(along, j * 12);
        const desk = new THREE.Mesh(new THREE.BoxGeometry(5, 1.1, 2.2), toon(0x7a5a3a));
        desk.position.set(p.x, 0.9, p.z); desk.rotation.y = ry; desk.castShadow = true;
        booths.add(desk);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.8, 0.2),
          new THREE.MeshBasicMaterial({ color: 0x10302a }));
        panel.position.set(p.x, 2.2, p.z).addScaledVector(inward, -1.0); panel.rotation.y = ry;
        booths.add(panel);
      }
    }
    outlineAll(booths, 0.03); this.scene.add(booths);

    // paper-slip confetti littering the floor
    this._buildConfetti();
  }

  _buildConfetti() {
    const N = 1400;
    const geo = new THREE.PlaneGeometry(0.28, 0.36);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false, color: 0xffffff });
    const inst = new THREE.InstancedMesh(geo, mat, N);
    const dummy = new THREE.Object3D();
    const tints = [new THREE.Color(0xffffff), new THREE.Color(0xffe9b0), new THREE.Color(0xc9e8ff), new THREE.Color(0xffd0d0)];
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    for (let i = 0; i < N; i++) {
      // cluster more paper around the pits
      let x, z;
      if (Math.random() < 0.6) {
        const pit = [[-26, -22], [0, -30], [26, -22], [-26, 22], [0, 30], [26, 22]][(Math.random() * 6) | 0];
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 6;
        x = pit[0] + Math.cos(a) * r; z = pit[1] + Math.sin(a) * r;
      } else { x = (Math.random() - 0.5) * 100; z = (Math.random() - 0.5) * 100; }
      dummy.position.set(x, 0.02 + Math.random() * 0.02, z);
      dummy.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      const c = tints[(Math.random() * tints.length) | 0];
      inst.setColorAt(i, c);
    }
    inst.receiveShadow = true;
    this.scene.add(inst);
  }

  _buildMasterBoard() {
    this.masterCanvas = document.createElement('canvas');
    this.masterCanvas.width = 1024; this.masterCanvas.height = 384;
    this.masterTex = new THREE.CanvasTexture(this.masterCanvas);
    this.masterTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(26, 9.75),
      new THREE.MeshBasicMaterial({ map: this.masterTex }));
    board.position.set(0, 14, -55.3); this.scene.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(27, 10.7, 0.6), toon(0x1a1f1d));
    frame.position.set(0, 14, -55.6); this.scene.add(frame);
    this._lastMaster = 0;
  }

  drawMaster(market) {
    const c = this.masterCanvas.getContext('2d');
    c.fillStyle = '#070a09'; c.fillRect(0, 0, 1024, 384);
    c.font = 'bold 30px sans-serif'; c.fillStyle = '#5b6f63'; c.textBaseline = 'top';
    c.fillText('CHICAGO BOARD OF TRADE', 28, 18);
    const rows = [...market.state.values()];
    c.textBaseline = 'middle';
    rows.forEach((s, i) => {
      const y = 96 + i * 46;
      c.font = 'bold 34px monospace'; c.fillStyle = '#cfe'; c.textAlign = 'left';
      c.fillText(s.symbol, 36, y);
      c.fillStyle = '#7c8a82'; c.font = '22px sans-serif';
      c.fillText(s.name, 130, y);
      const up = s.change > 0, dn = s.change < 0;
      c.fillStyle = up ? '#7dffc0' : dn ? '#ff8a8a' : '#e8e8e8';
      c.font = 'bold 34px monospace'; c.textAlign = 'right';
      c.fillText(fmtPrice(s.last, s.tickSize), 760, y);
      c.fillText(`${s.change > 0 ? '+' : ''}${s.change.toFixed(2)}`, 980, y);
    });
    this.masterTex.needsUpdate = true;
  }

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
    this.dust.userData.update(dt);
    if (time - this._lastMaster > 0.25) { this.drawMaster(market); this._lastMaster = time; }
    if (nearestState) {
      const warm = new THREE.Color(TEAL);
      if (nearestState.dir > 0) warm.lerp(new THREE.Color(0xfff0c0), nearestState.mood * 0.5);
      else if (nearestState.dir < 0) warm.lerp(new THREE.Color(0xff9a9a), nearestState.mood * 0.4);
      this.skyLight.color.lerp(warm, clamp(dt * 2, 0, 1));
      // bloom swells with the action
      this.bloom.strength = damp(this.bloom.strength, 0.55 + nearestState.mood * 0.5, 4, dt);
    }
  }

  render() { this.composer.render(); }

  _resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }
}

// ---- small procedural textures (no asset files) ----
function makeWood() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = '#b07f4d'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 16) {
    x.fillStyle = i % 32 === 0 ? '#a3743f' : '#bd8c57';
    x.fillRect(0, i, 256, 14);
    x.strokeStyle = 'rgba(60,40,20,0.18)'; x.strokeRect(0, i, 256, 14);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(26, 26);
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
