import * as THREE from 'three';
import { toon, fmtPrice, clamp, lerp, damp, rand } from './util.js';
import { createTrader } from './traders.js';
import { outlineAll, makeSky, makeDust, makeShaft, makeComposer } from './fx.js';

// Warm, cozy palette (the look that read best) over an authentic sunken-pit
// layout: teal skylight, cream plaster, warm parquet, brass and wood.
const TEAL = 0x86d9c9;
const CREAM = 0xe9dcb8;
const STONE = 0xd8cba6;
const STEP = 0x705a3e;     // warm wood pit steps
const RISER = 0x4d3d29;
const ROT8 = Math.PI / 8;

const HALF = 30;           // half floor size — a tighter, busier room
const WALLH = 18;          // wall / ceiling height

// One trading pit: an octagonal well sunk into the floor as descending steps,
// packed with traders in loud jackets standing on the rim and steps facing the
// centre. A hovering sign names the instrument; a mood light + bloom sprite at
// the bottom brighten and flash green/red with order flow.
class Pit {
  constructor(cfg) {
    this.cfg = cfg;
    this.group = new THREE.Group();
    this.group.position.set(cfg.pos[0], 0, cfg.pos[2]);
    this.worldPos = new THREE.Vector3(cfg.pos[0], 0, cfg.pos[2]);
    this.color = new THREE.Color(cfg.color);
    this.R = 6;
    this._lastBoard = 0;
    this._build();
  }

  _build() {
    const R = this.R, S = 4, dr = 1.05, stepH = 0.55;
    const shell = new THREE.Group();
    const stepMat = toon(STEP);
    const riserMat = toon(RISER);

    const rings = [];
    for (let i = 0; i < S; i++) {
      const rOut = R - i * dr;
      const rIn = R - (i + 1) * dr;
      const y = -i * stepH;
      const tread = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 8, 1), stepMat);
      tread.rotation.x = -Math.PI / 2; tread.rotation.z = ROT8;
      tread.position.y = y; tread.receiveShadow = true; shell.add(tread);
      const riser = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, stepH, 8, 1, true), riserMat);
      riser.rotation.y = ROT8; riser.position.y = y - stepH / 2; shell.add(riser);
      rings.push({ y, mid: (rIn + rOut) / 2 });
    }
    const bottomR = R - S * dr;
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(bottomR, bottomR, 0.2, 8), toon(0x3a2c1c));
    bottom.rotation.y = ROT8; bottom.position.y = -S * stepH; shell.add(bottom);

    // brass rail + posts around the rim
    const rail = new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.06, 8, 8), toon(0xe0b24a));
    rail.rotation.x = Math.PI / 2; rail.rotation.z = ROT8; rail.position.y = 0.9; shell.add(rail);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2 + ROT8;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), toon(0xc09636));
      post.position.set(Math.cos(a) * (R + 0.15), 0.45, Math.sin(a) * (R + 0.15)); shell.add(post);
    }

    // a packed crowd on the rim and every step, all facing the centre
    this.traders = [];
    const plan = [
      [R + 0.55, 0.0, 14],
      [rings[1].mid, rings[1].y, 11],
      [rings[2].mid, rings[2].y, 8],
      [rings[3].mid, rings[3].y, 5],
    ];
    for (const [radius, y, count] of plan) {
      for (let i = 0; i < count; i++) {
        const tr = createTrader();
        const a = (i / count) * Math.PI * 2 + rand(-0.08, 0.08) + y * 1.7;
        tr.group.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
        tr.group.rotation.y = -a + Math.PI / 2 + Math.PI;
        tr.group.scale.setScalar(rand(0.9, 1.08));
        shell.add(tr.group); this.traders.push(tr);
      }
    }

    outlineAll(shell, 0.03);
    this.group.add(shell);

    // a few clerk desks around the rim
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + ROT8 / 2;
      const booth = new THREE.Group();
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.0), toon(0x7a5a3a));
      desk.position.y = 0.45; booth.add(desk);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.7),
        new THREE.MeshBasicMaterial({ color: 0x123b30 }));
      scr.position.set(0, 1.15, 0.1); booth.add(scr);
      booth.position.set(Math.cos(a) * (R + 2.2), 0, Math.sin(a) * (R + 2.2));
      booth.lookAt(0, 0, 0); outlineAll(booth, 0.025); this.group.add(booth);
    }

    // hovering instrument sign
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 512; this.boardCanvas.height = 256;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 3.2),
      new THREE.MeshBasicMaterial({ map: this.boardTex }));
    board.position.y = 4.4; this.group.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.8, 3.4), toon(0x23262a));
    frame.position.y = 4.4; this.group.add(frame);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 8), toon(0x2a2a2a));
    mast.position.y = 3.2; this.group.add(mast);

    this.light = new THREE.PointLight(this.cfg.color, 5, 22, 2);
    this.light.position.y = 1.6; this.group.add(this.light);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlow(), color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.glow.scale.set(8, 8, 1); this.glow.position.y = 1.2; this.group.add(this.glow);

    this.drawBoard({ last: this.cfg.basePrice, change: 0, dir: 0, delta: 0 });
  }

  drawBoard(s) {
    const c = this.boardCanvas.getContext('2d');
    c.fillStyle = '#0c0f0e'; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#1a1f1d'; c.fillRect(8, 8, 496, 240);
    c.fillStyle = '#' + this.color.getHexString();
    c.font = 'bold 84px monospace'; c.textBaseline = 'top'; c.textAlign = 'left';
    c.fillText(this.cfg.symbol, 24, 18);
    c.fillStyle = '#9aa'; c.font = '20px sans-serif';
    c.fillText(this.cfg.name, 26, 96);
    const up = s.change > 0, dn = s.change < 0;
    c.fillStyle = up ? '#7dffc0' : dn ? '#ff8a8a' : '#e8e8e8';
    c.font = 'bold 70px monospace'; c.textAlign = 'right';
    c.fillText(fmtPrice(s.last, this.cfg.tickSize), 488, 128);
    c.font = 'bold 28px monospace';
    c.fillText(`${s.change > 0 ? '+' : ''}${s.change.toFixed(2)}`, 488, 204);
    this.boardTex.needsUpdate = true;
  }

  react(s, time, dt) {
    for (const t of this.traders) t.update(time, s.mood, s.dir, s.shout);
    this.light.intensity = damp(this.light.intensity, 3 + s.mood * 7 + s.flash * 12, 6, dt);
    const tint = new THREE.Color(this.cfg.color);
    if (s.flash > 0.01) tint.lerp(new THREE.Color(s.flashDir > 0 ? 0x46ff9a : 0xff4d4d), clamp(s.flash, 0, 0.85));
    this.light.color.lerp(tint, clamp(dt * 8, 0, 1));
    this.glow.material.color.set(s.flashDir > 0 ? 0x46ff9a : 0xff5d5d);
    this.glow.material.opacity = damp(this.glow.material.opacity, s.flash * 0.85, 10, dt);
    this.glow.scale.setScalar(lerp(7, 15, s.flash));
    if (time - this._lastBoard > 0.08) { this.drawBoard(s); this._lastBoard = time; }
  }
}

export class World {
  constructor(canvas, pits) {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd9efe4, 0.012);

    this.camera = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.1, 500);
    this.camera.position.set(0, 6, 18);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.add(makeSky());
    this.dust = makeDust(280, HALF * 2, WALLH);
    this.scene.add(this.dust);

    this._buildHall(pits);
    this.pits = pits.map((c) => new Pit(c));
    for (const p of this.pits) this.scene.add(p.group);

    const fx = makeComposer(this.renderer, this.scene, this.camera);
    this.composer = fx.composer; this.bloom = fx.bloom;

    addEventListener('resize', () => this._resize());
  }

  _buildHall(pits) {
    const hemi = new THREE.HemisphereLight(TEAL, 0xc89a5a, 1.1);
    this.scene.add(hemi); this.skyLight = hemi;
    const sun = new THREE.DirectionalLight(0xfff1da, 1.6);
    sun.position.set(18, 34, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 110;
    sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
    sun.shadow.bias = -0.0004; this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xeafaf4, 0.45));

    // warm parquet floor with an octagonal hole punched for each pit
    const wood = makeWood(); wood.repeat.set(0.07, 0.07);
    const shape = new THREE.Shape();
    shape.moveTo(-HALF, -HALF); shape.lineTo(HALF, -HALF); shape.lineTo(HALF, HALF);
    shape.lineTo(-HALF, HALF); shape.lineTo(-HALF, -HALF);
    for (const p of pits) {
      const path = new THREE.Path();
      octagon(path, p.pos[0], -p.pos[2], 6); shape.holes.push(path);
    }
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape),
      new THREE.MeshToonMaterial({ map: wood }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);

    // cream walls with tall arched teal windows + light shafts
    const wallMat = toon(CREAM);
    const winMat = new THREE.MeshBasicMaterial({ color: 0xcdf7ec });
    const trimMat = toon(0xb89a5a);
    const len = HALF * 2;
    const dirs = [[0, -HALF, 0], [0, HALF, Math.PI], [-HALF, 0, Math.PI / 2], [HALF, 0, -Math.PI / 2]];
    for (const [x, z, ry] of dirs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, WALLH, 1), wallMat);
      wall.position.set(x, WALLH / 2, z); wall.rotation.y = ry; wall.receiveShadow = true;
      this.scene.add(wall);
      const along = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
      const inward = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(-Math.sign(x + z) || -1);
      for (let i = -2; i <= 2; i++) {
        const base = new THREE.Vector3(x, 9, z).addScaledVector(along, i * 10);
        const w = new THREE.Mesh(new THREE.PlaneGeometry(5, 10), winMat);
        w.position.copy(base).addScaledVector(inward, 0.52); w.rotation.y = ry; this.scene.add(w);
        const arch = new THREE.Mesh(new THREE.CircleGeometry(2.5, 16, 0, Math.PI), winMat);
        arch.position.copy(base).addScaledVector(inward, 0.52); arch.position.y = 14; arch.rotation.y = ry;
        this.scene.add(arch);
        const shaft = makeShaft(5, 22);
        shaft.position.copy(base).addScaledVector(inward, 5).setY(6);
        shaft.lookAt(base.x, 0, base.z); shaft.rotation.x += 0.5; this.scene.add(shaft);
      }
      const trim = new THREE.Mesh(new THREE.BoxGeometry(len, 1.4, 1.2), trimMat);
      trim.position.set(x, 0.7, z).addScaledVector(inward, 0.1); trim.rotation.y = ry; this.scene.add(trim);
    }

    // coffered ceiling with glowing skylight strips + beams
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(len, len), toon(0x6b5b44));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = WALLH; this.scene.add(ceil);
    const strip = new THREE.MeshBasicMaterial({ color: 0xeafff8 });
    for (let i = -1; i <= 1; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(len - 12, 3.5), strip);
      s.rotation.x = Math.PI / 2; s.position.set(0, WALLH - 0.2, i * 16); this.scene.add(s);
    }
    const beamMat = toon(0x4a3f2e);
    for (let i = -1; i <= 1; i++) {
      const bx = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, 1.2), beamMat);
      bx.position.set(0, WALLH - 0.5, i * 16); this.scene.add(bx);
      const bz = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, len), beamMat);
      bz.position.set(i * 16, WALLH - 0.5, 0); this.scene.add(bz);
    }

    // stone columns in the corners + hanging pendant lamps
    const cols = new THREE.Group();
    const colGeo = new THREE.CylinderGeometry(0.9, 1.1, WALLH, 12);
    for (const cx of [-HALF + 4, HALF - 4]) for (const cz of [-HALF + 4, HALF - 4]) {
      const col = new THREE.Mesh(colGeo, toon(STONE));
      col.position.set(cx, WALLH / 2, cz); col.castShadow = true; cols.add(col);
    }
    outlineAll(cols, 0.05); this.scene.add(cols);
    for (const [lx, lz] of [[-15, 0], [15, 0], [0, -16], [0, 16]]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 5, 6), toon(0x222));
      cord.position.set(lx, WALLH - 2.5, lz); this.scene.add(cord);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe6ad }));
      bulb.position.set(lx, WALLH - 5, lz); this.scene.add(bulb);
      const pl = new THREE.PointLight(0xffe2a8, 1.1, 34, 2);
      pl.position.set(lx, WALLH - 5, lz); this.scene.add(pl);
    }

    this._buildConfetti(pits);
  }

  _buildConfetti(pits) {
    const N = 1200;
    const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.26, 0.34),
      toon(0xffffff, { side: THREE.DoubleSide }), N);
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    const dummy = new THREE.Object3D();
    const tints = [0xffffff, 0xffe9b0, 0xc9e8ff, 0xffd0d0].map((c) => new THREE.Color(c));
    for (let i = 0; i < N; i++) {
      let x, z, y = 0.02;
      if (Math.random() < 0.7) {
        const p = pits[(Math.random() * pits.length) | 0].pos;
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 5;
        x = p[0] + Math.cos(a) * r; z = p[2] + Math.sin(a) * r;
        y = -Math.random() * 1.4 + 0.02;
      } else { x = (Math.random() - 0.5) * HALF * 1.9; z = (Math.random() - 0.5) * HALF * 1.9; }
      dummy.position.set(x, y, z);
      dummy.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
      dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      inst.setColorAt(i, tints[(Math.random() * tints.length) | 0]);
    }
    this.scene.add(inst);
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
    if (nearestState) {
      const warm = new THREE.Color(TEAL);
      if (nearestState.dir > 0) warm.lerp(new THREE.Color(0xfff0c0), nearestState.mood * 0.5);
      else if (nearestState.dir < 0) warm.lerp(new THREE.Color(0xff9a9a), nearestState.mood * 0.4);
      this.skyLight.color.lerp(warm, clamp(dt * 2, 0, 1));
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

// octagon hole path (clockwise) centred at (cx, cy) in shape space
function octagon(path, cx, cy, r) {
  for (let k = 0; k <= 8; k++) {
    const a = -k / 8 * Math.PI * 2 + ROT8;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (k === 0) path.moveTo(x, y); else path.lineTo(x, y);
  }
}

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
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
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
