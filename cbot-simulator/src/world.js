import * as THREE from 'three';
import { toon, fmtPrice, clamp, lerp, damp, rand } from './util.js';
import { createTrader } from './traders.js';
import { outlineAll, makeDust, makeComposer } from './fx.js';

// Palette tuned to the real CBOT floor: a dark room lit mostly by the wall of
// glowing red/green/amber quote boards, with warm recessed downlights.
const CARPET = 0x33373f;
const WALL = 0x14161a;
const STEP = 0x2b2f36;
const RISER = 0x191c21;
const GREEN = '#37e08a';
const RED = '#ff5d5d';
const AMBER = '#ffc04e';

const ROT8 = Math.PI / 8;   // align octagons flat-side-front

// One trading pit: an octagonal well sunk into the floor as descending steps,
// ringed by traders in loud jackets who stand on the steps facing the centre.
// A hovering sign calls out the instrument; a mood light + bloom sprite at the
// bottom of the well brighten and flash green/red with order flow.
class Pit {
  constructor(cfg) {
    this.cfg = cfg;
    this.group = new THREE.Group();
    this.group.position.set(cfg.pos[0], 0, cfg.pos[2]);
    this.worldPos = new THREE.Vector3(cfg.pos[0], 0, cfg.pos[2]);
    this.color = new THREE.Color(cfg.color);
    this.R = 6;            // top-rim radius (matches the floor hole)
    this._lastBoard = 0;
    this._build();
  }

  _build() {
    const R = this.R, S = 4, dr = 1.05, stepH = 0.6;
    const shell = new THREE.Group();
    const stepMat = toon(STEP);
    const riserMat = toon(RISER);

    // descending octagonal steps (flat treads + vertical risers)
    const rings = [];
    for (let i = 0; i < S; i++) {
      const rOut = R - i * dr;
      const rIn = R - (i + 1) * dr;
      const y = -i * stepH;
      const tread = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 8, 1), stepMat);
      tread.rotation.x = -Math.PI / 2; tread.rotation.z = ROT8;
      tread.position.y = y; tread.receiveShadow = true;
      shell.add(tread);
      const riser = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, stepH, 8, 1, true), riserMat);
      riser.rotation.y = ROT8; riser.position.y = y - stepH / 2;
      shell.add(riser);
      rings.push({ y, mid: (rIn + rOut) / 2 });
    }
    // pit floor at the bottom + a small centre post
    const bottomR = R - S * dr;
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(bottomR, bottomR, 0.2, 8),
      toon(0x121417));
    bottom.rotation.y = ROT8; bottom.position.y = -S * stepH; shell.add(bottom);

    // brass rail around the rim
    const rail = new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.06, 8, 8), toon(0xd9ad48));
    rail.rotation.x = Math.PI / 2; rail.rotation.z = ROT8; rail.position.y = 0.9;
    shell.add(rail);
    for (let k = 0; k < 8; k++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), toon(0xb89030));
      const a = k / 8 * Math.PI * 2 + ROT8;
      post.position.set(Math.cos(a) * (R + 0.15), 0.45, Math.sin(a) * (R + 0.15));
      shell.add(post);
    }

    // the crowd, standing on the rim and the upper steps facing the centre
    this.traders = [];
    const ringPlan = [[R + 0.55, 0.0, 7], [rings[1].mid, rings[1].y, 6], [rings[2].mid, rings[2].y, 5]];
    for (const [radius, y, count] of ringPlan) {
      for (let i = 0; i < count; i++) {
        const tr = createTrader();
        const a = (i / count) * Math.PI * 2 + rand(-0.1, 0.1) + (y * 1.3);
        tr.group.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
        tr.group.rotation.y = -a + Math.PI / 2 + Math.PI;
        tr.group.scale.setScalar(rand(0.92, 1.08));
        shell.add(tr.group);
        this.traders.push(tr);
      }
    }

    outlineAll(shell, 0.03);
    this.group.add(shell);

    // monitor booths around the outer rim
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2 + ROT8 / 2;
      const booth = new THREE.Group();
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.0), toon(0x33373d));
      desk.position.y = 0.45; booth.add(desk);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.7),
        new THREE.MeshBasicMaterial({ color: 0x0f3b2e }));
      scr.position.set(0, 1.15, 0.1); booth.add(scr);
      booth.position.set(Math.cos(a) * (R + 2.4), 0, Math.sin(a) * (R + 2.4));
      booth.lookAt(0, 0, 0);
      outlineAll(booth, 0.025);
      this.group.add(booth);
    }

    // hovering instrument sign (4-sided so it reads from any approach)
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 512; this.boardCanvas.height = 256;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.7, 3.4),
      new THREE.MeshBasicMaterial({ map: this.boardTex }));
    board.position.y = 4.6; this.group.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.9, 3.6), toon(0x0c0e10));
    frame.position.y = 4.6; this.group.add(frame);

    // mood light + bloom flash at the bottom of the well
    this.light = new THREE.PointLight(this.cfg.color, 5, 24, 2);
    this.light.position.y = 1.5; this.group.add(this.light);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlow(), color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.glow.scale.set(9, 9, 1); this.glow.position.y = 1.2; this.group.add(this.glow);

    this.drawBoard({ last: this.cfg.basePrice, change: 0, dir: 0, delta: 0 });
  }

  drawBoard(s) {
    const c = this.boardCanvas.getContext('2d');
    c.fillStyle = '#070a09'; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#' + this.color.getHexString();
    c.font = 'bold 90px monospace'; c.textBaseline = 'top'; c.textAlign = 'left';
    c.fillText(this.cfg.symbol, 26, 20);
    const up = s.change > 0, dn = s.change < 0;
    c.fillStyle = up ? GREEN : dn ? RED : '#e8e8e8';
    c.font = 'bold 72px monospace'; c.textAlign = 'right';
    c.fillText(fmtPrice(s.last, this.cfg.tickSize), 488, 120);
    c.font = 'bold 30px monospace';
    c.fillText(`${s.change > 0 ? '+' : ''}${s.change.toFixed(2)}`, 488, 200);
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
    this.glow.scale.setScalar(lerp(7, 16, s.flash));
    if (time - this._lastBoard > 0.08) { this.drawBoard(s); this._lastBoard = time; }
  }
}

export class World {
  constructor(canvas, pits) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x10131a);
    this.scene.fog = new THREE.FogExp2(0x141821, 0.006);

    this.camera = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.1, 500);
    this.camera.position.set(0, 6, 18);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.dust = makeDust(180, 70, 15);
    this.scene.add(this.dust);

    this._buildHall(pits);

    this.pits = pits.map((c) => new Pit(c));
    for (const p of this.pits) this.scene.add(p.group);

    const fx = makeComposer(this.renderer, this.scene, this.camera);
    this.composer = fx.composer; this.bloom = fx.bloom;
    this.renderer.toneMappingExposure = 1.0;

    addEventListener('resize', () => this._resize());
  }

  _buildHall(pits) {
    // dim, moody ambient — the boards and downlights carry the room
    this.scene.add(new THREE.AmbientLight(0x6a7686, 1.05));
    const hemi = new THREE.HemisphereLight(0x9aa6bc, 0x2a2018, 0.85);
    this.scene.add(hemi); this.skyLight = hemi;
    const sun = new THREE.DirectionalLight(0xfff1da, 0.85);
    sun.position.set(20, 40, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    sun.shadow.bias = -0.0004; this.scene.add(sun);

    // dark carpet floor with an octagonal hole punched out for each pit
    const shape = new THREE.Shape();
    shape.moveTo(-60, -60); shape.lineTo(60, -60); shape.lineTo(60, 60); shape.lineTo(-60, 60); shape.lineTo(-60, -60);
    for (const p of pits) {
      const path = new THREE.Path();
      // shape-space y maps to world -z after the -90° rotation below
      octagon(path, p.pos[0], -p.pos[2], 6);
      shape.holes.push(path);
    }
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), toon(CARPET));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.scene.add(floor);

    // walls clad in glowing LED quote boards
    this.boards = [];
    const S = 56, H = 24;
    const dirs = [[0, -S, 0], [0, S, Math.PI], [-S, 0, Math.PI / 2], [S, 0, -Math.PI / 2]];
    for (const [x, z, ry] of dirs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(120, H, 1.2), toon(WALL));
      wall.position.set(x, H / 2, z); wall.rotation.y = ry; this.scene.add(wall);
      const inward = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(-Math.sign(x + z) || -1);
      // two rows of quote boards
      for (let row = 0; row < 2; row++) {
        const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 384;
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(108, 7.4),
          new THREE.MeshBasicMaterial({ map: tex }));
        panel.position.set(x, 9 + row * 8.2, z).addScaledVector(inward, 0.62);
        panel.rotation.y = ry;          // face inward, toward the room
        this.scene.add(panel);
        const rec = { cv, tex };
        drawQuoteBoard(rec); this.boards.push(rec);
      }
    }

    // dark coffered ceiling with recessed downlights
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), toon(0x101216));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 24; this.scene.add(ceil);
    const downMat = new THREE.MeshBasicMaterial({ color: 0xffe9c0 });
    for (let gx = -44; gx <= 44; gx += 11) for (let gz = -44; gz <= 44; gz += 11) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), downMat);
      d.rotation.x = Math.PI / 2; d.position.set(gx, 23.7, gz); this.scene.add(d);
    }
    for (const [lx, lz] of [[-24, -24], [24, -24], [-24, 24], [24, 24], [0, 0]]) {
      const pl = new THREE.PointLight(0xffe2a8, 1.8, 64, 2);
      pl.position.set(lx, 16, lz); this.scene.add(pl);
    }

    this._buildConfetti(pits);
    this._lastBoardPaint = 0; this._boardCursor = 0;
  }

  _buildConfetti(pits) {
    const N = 1600;
    const inst = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.26, 0.34),
      toon(0xffffff, { side: THREE.DoubleSide }), N);
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    const dummy = new THREE.Object3D();
    // muted paper tints (lit, not glowing) so the slips read as litter
    const tints = [0xb6b6bc, 0xc6bb96, 0x9fb4c2, 0xc1a0a0].map((c) => new THREE.Color(c));
    for (let i = 0; i < N; i++) {
      let x, z, y = 0.02;
      if (Math.random() < 0.7) {
        const p = pits[(Math.random() * pits.length) | 0].pos;
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 5;
        x = p[0] + Math.cos(a) * r; z = p[2] + Math.sin(a) * r;
        y = -Math.random() * 1.5 + 0.02;     // some slips down in the well
      } else { x = (Math.random() - 0.5) * 100; z = (Math.random() - 0.5) * 100; }
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
    // repaint one wall board per ~0.4s so the LED walls feel alive
    if (time - this._lastBoardPaint > 0.4 && this.boards.length) {
      drawQuoteBoard(this.boards[this._boardCursor % this.boards.length]);
      this._boardCursor++; this._lastBoardPaint = time;
    }
    if (nearestState) {
      this.bloom.strength = damp(this.bloom.strength, 0.6 + nearestState.mood * 0.5, 4, dt);
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

// octagon hole path centred at (cx, cy) in shape space, wound clockwise so it
// reads as a hole against the counter-clockwise outer rectangle
function octagon(path, cx, cy, r) {
  for (let k = 0; k <= 8; k++) {
    const a = -k / 8 * Math.PI * 2 + ROT8;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (k === 0) path.moveTo(x, y); else path.lineTo(x, y);
  }
}

// Paint a wall of scrolling red/green/amber quotes — the defining CBOT look.
function drawQuoteBoard(rec) {
  const { cv } = rec; const c = cv.getContext('2d');
  c.fillStyle = '#05060a'; c.fillRect(0, 0, cv.width, cv.height);
  const cols = 9, rows = 4, cw = cv.width / cols, rh = cv.height / rows;
  const syms = ['ZB', 'ZN', 'ZC', 'ZS', 'ZW', 'ES', 'ZF', 'ZT', 'ZO', 'YM', 'NQ', 'GC'];
  c.textBaseline = 'middle';
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    const x = col * cw + 14, y = r * rh + rh / 2;
    c.font = 'bold 30px monospace'; c.textAlign = 'left';
    c.fillStyle = AMBER;
    c.fillText(syms[(r * cols + col) % syms.length], x, y);
    const up = Math.random() < 0.5;
    c.fillStyle = up ? GREEN : RED;
    c.font = '28px monospace'; c.textAlign = 'right';
    const v = (Math.random() * 9000 + 100).toFixed(2);
    c.fillText((up ? '' : '-') + v, x + cw - 24, y);
  }
  rec.tex.needsUpdate = true;
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
