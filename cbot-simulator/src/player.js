import * as THREE from 'three';
import { toon, clamp, lerp, damp } from './util.js';

const FLOOR = 52;   // half-extent the player can roam before the walls

// Third-person runner. A small backpacked character (a nod to Messenger) that
// runs around the floor with WASD / arrows, sprint on Shift. The camera orbits
// behind on mouse / touch drag and follows with smooth damping. Pits act as
// solid obstacles you bump around.
export class Player {
  constructor(camera, colliders) {
    this.camera = camera;
    this.colliders = colliders; // [{ pos: Vector3, radius }]
    this.pos = new THREE.Vector3(0, 0, 8);
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.yaw = 0;          // camera orbit
    this.pitch = 0.32;
    this.dist = 9;
    this.speed = 9;
    this.keys = new Set();
    this.run = 0;          // gait phase

    this.group = this._buildAvatar();
    this.group.position.copy(this.pos);

    this._bindInput();
  }

  _buildAvatar() {
    const g = new THREE.Group();
    const jacket = toon(0xff5d5d);     // red hoodie
    const skin = toon(0xffdbac);
    const dark = toon(0x33373f);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), jacket);
    torso.position.y = 0.95; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), skin);
    head.position.y = 1.46; head.castShadow = true; g.add(head);
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.215, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), toon(0x20180f));
    hair.position.y = 1.48; g.add(hair);
    // backpack
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.2), toon(0x4ec9ff));
    pack.position.set(0, 1.0, -0.26); g.add(pack);

    this.limbs = { legs: [], arms: [] };
    const legGeo = new THREE.CapsuleGeometry(0.12, 0.42, 3, 6);
    for (const x of [-0.13, 0.13]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.72, 0);
      const leg = new THREE.Mesh(legGeo, dark); leg.position.y = -0.3; leg.castShadow = true;
      pivot.add(leg); g.add(pivot); this.limbs.legs.push(pivot);
    }
    const armGeo = new THREE.CapsuleGeometry(0.08, 0.4, 3, 6);
    for (const x of [-0.3, 0.3]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 1.18, 0);
      const arm = new THREE.Mesh(armGeo, jacket); arm.position.y = -0.24; arm.castShadow = true;
      pivot.add(arm); g.add(pivot); this.limbs.arms.push(pivot);
    }
    return g;
  }

  _bindInput() {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));

    const onDrag = (dx, dy) => {
      this.yaw -= dx * 0.005;
      this.pitch = clamp(this.pitch - dy * 0.004, -0.2, 1.0);
    };
    let px = 0, py = 0, down = false;
    const start = (x, y) => { down = true; px = x; py = y; };
    const move = (x, y) => { if (down) { onDrag(x - px, y - py); px = x; py = y; } };
    const end = () => { down = false; };
    addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
    addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    addEventListener('mouseup', end);
    addEventListener('touchstart', (e) => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
    addEventListener('touchmove', (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
    addEventListener('touchend', end);
    addEventListener('wheel', (e) => { this.dist = clamp(this.dist + Math.sign(e.deltaY), 5, 18); }, { passive: true });
  }

  update(dt, time) {
    // desired move direction in camera space
    const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp')) - (this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const s = (this.keys.has('KeyD') || this.keys.has('ArrowRight')) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1.7 : 1;

    const dir = new THREE.Vector3();
    if (f || s) {
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      // forward is -Z rotated by yaw
      dir.set(s * cy - f * sy, 0, -f * cy - s * sy).normalize();
    }
    const targetVel = dir.multiplyScalar(this.speed * sprint);
    this.vel.x = damp(this.vel.x, targetVel.x, 10, dt);
    this.vel.z = damp(this.vel.z, targetVel.z, 10, dt);
    this.pos.addScaledVector(this.vel, dt);

    // keep inside the hall
    this.pos.x = clamp(this.pos.x, -FLOOR, FLOOR);
    this.pos.z = clamp(this.pos.z, -FLOOR, FLOOR);
    // push out of pits
    for (const c of this.colliders) {
      const d = Math.hypot(this.pos.x - c.pos.x, this.pos.z - c.pos.z);
      if (d < c.radius) {
        const nx = (this.pos.x - c.pos.x) / (d || 1), nz = (this.pos.z - c.pos.z) / (d || 1);
        this.pos.x = c.pos.x + nx * c.radius;
        this.pos.z = c.pos.z + nz * c.radius;
      }
    }

    const moving = this.vel.lengthSq() > 0.4;
    if (moving) this.facing = Math.atan2(this.vel.x, this.vel.z);
    this.group.position.copy(this.pos);
    this.group.rotation.y = lerp(this.group.rotation.y, this.facing, Math.min(1, dt * 12));

    // run cycle
    const gait = this.vel.length() * 1.2;
    this.run += dt * (4 + gait);
    const swing = moving ? Math.sin(this.run * 2) : Math.sin(time * 2) * 0.05;
    this.limbs.legs[0].rotation.x = swing * (moving ? 1.0 : 0.2);
    this.limbs.legs[1].rotation.x = -swing * (moving ? 1.0 : 0.2);
    this.limbs.arms[0].rotation.x = -swing * (moving ? 0.9 : 0.15);
    this.limbs.arms[1].rotation.x = swing * (moving ? 0.9 : 0.15);
    this.group.position.y = moving ? Math.abs(Math.sin(this.run * 2)) * 0.06 : 0;

    this._followCam(dt);
  }

  _followCam(dt) {
    const tx = this.pos.x - Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist;
    const tz = this.pos.z - Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist;
    const ty = this.pos.y + 2 + Math.sin(this.pitch) * this.dist;
    this.camera.position.x = damp(this.camera.position.x, tx, 8, dt);
    this.camera.position.y = damp(this.camera.position.y, ty, 8, dt);
    this.camera.position.z = damp(this.camera.position.z, tz, 8, dt);
    this.camera.lookAt(this.pos.x, this.pos.y + 1.4, this.pos.z);
  }
}
