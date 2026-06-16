import * as THREE from 'three';
import { toon, rand, pick, clamp, lerp } from './util.js';

// The garish trading-jacket palette — the one genuinely accurate detail of the
// open-outcry era. Clerks and locals wore loud colours so they could be picked
// out across a crowded pit.
const JACKETS = [0xff5d5d, 0xffb14e, 0xffe14e, 0x5dff8f, 0x4ec9ff, 0x9b6bff, 0xff6bd6, 0x7CFC00, 0xff8c42];
const SKIN = [0xf2c79b, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbac];

// A single chunky, toon-shaded floor trader. Returns a group plus an `update`
// that animates idle sway and bid/offer hand signals. The arms pivot at the
// shoulder; raising them toward the face = bidding (palms in), pushing them out
// = offering (palms out) — driven by order-flow direction and intensity.
export function createTrader() {
  const g = new THREE.Group();
  const jacket = toon(pick(JACKETS));
  const skin = toon(pick(SKIN));
  const dark = toon(0x2b2b33);

  // legs
  const legGeo = new THREE.CapsuleGeometry(0.12, 0.42, 3, 6);
  for (const x of [-0.13, 0.13]) {
    const leg = new THREE.Mesh(legGeo, dark);
    leg.position.set(x, 0.33, 0);
    leg.castShadow = true; g.add(leg);
  }
  // torso (the jacket)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), jacket);
  torso.position.y = 0.95; torso.castShadow = true; g.add(torso);
  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skin);
  head.position.y = 1.45; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.205, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), toon(pick([0x2b2118, 0x111111, 0x55402a, 0x888888])));
  hair.position.y = 1.47; g.add(hair);

  // arms — each is a pivot group rotating at the shoulder
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.28, 1.18, 0);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.46, 3, 6), jacket);
    upper.position.y = -0.25; upper.castShadow = true;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), skin);
    hand.position.y = -0.52;
    pivot.add(upper, hand);
    pivot.rotation.z = side * 0.2;
    g.add(pivot);
    arms.push({ pivot, side });
  }

  const phase = rand(0, Math.PI * 2);
  const speed = rand(0.8, 1.4);

  return {
    group: g,
    // mood 0..1, dir -1/0/1, shout 0..1 (spikes on big prints)
    update(time, mood, dir, shout) {
      const t = time * speed + phase;
      // idle bob + jacket sway scales with how hot the pit is
      g.position.y = Math.sin(t * 2) * 0.02 * (0.5 + mood);
      head.rotation.y = Math.sin(t * 0.6) * 0.3;

      // signalling rate: calm pits gesture slowly, frantic pits flail
      const rate = 4 + mood * 10 + shout * 6;
      const reach = 0.4 + mood * 0.9 + shout * 0.8;
      for (const a of arms) {
        const swing = Math.sin(t * rate + a.side) * 0.5 + 0.5;
        // bidding (dir>0) pulls hands up toward the face; offering pushes out
        const bias = dir >= 0 ? -1 : 1;
        const target = a.side * (0.2 + reach * 0.4 * bias) + bias * (0.4 + reach) * swing;
        a.pivot.rotation.x = lerp(a.pivot.rotation.x, -reach * swing * 1.4, 0.3);
        a.pivot.rotation.z = lerp(a.pivot.rotation.z, target, 0.3);
      }
      // a big print makes everyone hop and throw their arms up
      if (shout > 0.05) {
        g.position.y += shout * 0.12 * Math.abs(Math.sin(time * 16 + phase));
      }
    },
  };
}

// Distribute traders evenly around the rim of an octagonal pit of `radius`,
// facing inward toward the centre.
export function placeTraders(count, radius) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const tr = createTrader();
    const a = (i / count) * Math.PI * 2 + rand(-0.08, 0.08);
    const r = radius * rand(0.86, 1.02);
    tr.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    tr.group.rotation.y = -a + Math.PI / 2 + Math.PI; // face the centre
    tr.group.scale.setScalar(rand(0.92, 1.1));
    out.push(tr);
  }
  return out;
}
