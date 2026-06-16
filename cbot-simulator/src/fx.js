import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Cel ink outlines (inverted-hull).
//
// For each mesh we render a slightly inflated copy with back-faces only and a
// dark flat colour. Pushing every vertex out along its normal by a fixed world
// distance produces the clean, even ink line that reads as "anime", instead of
// the smooth untextured primitives we had before.
// ---------------------------------------------------------------------------
const _outlineMats = new Map();
function outlineMaterial(thickness) {
  if (_outlineMats.has(thickness)) return _outlineMats.get(thickness);
  const m = new THREE.ShaderMaterial({
    uniforms: { thickness: { value: thickness } },
    vertexShader: `
      uniform float thickness;
      void main() {
        vec3 p = position + normalize(normal) * thickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `void main() { gl_FragColor = vec4(0.05, 0.10, 0.09, 1.0); }`,
    side: THREE.BackSide,
  });
  _outlineMats.set(thickness, m);
  return m;
}

// Attach an outline child to every mesh under `root`.
export function outlineAll(root, thickness = 0.03) {
  const targets = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) targets.push(o); });
  for (const mesh of targets) {
    if (!mesh.geometry.getAttribute('normal')) continue;
    const o = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness));
    o.userData.isOutline = true;
    o.frustumCulled = false;
    mesh.add(o);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Gradient sky dome — soft teal up high fading to warm haze at the horizon,
// the Messenger-style seafoam light.
// ---------------------------------------------------------------------------
export function makeSky() {
  const geo = new THREE.SphereGeometry(220, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x8fe7d8) },
      mid: { value: new THREE.Color(0xcdeee2) },
      bot: { value: new THREE.Color(0xf6e7c8) },
    },
    vertexShader: `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vP;
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      void main() {
        float h = normalize(vP).y * 0.5 + 0.5;
        vec3 c = h > 0.5 ? mix(mid, top, (h - 0.5) * 2.0) : mix(bot, mid, h * 2.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  return sky;
}

// ---------------------------------------------------------------------------
// Floating dust motes caught in the light — slow drifting additive specks that
// give the air some volume.
// ---------------------------------------------------------------------------
export function makeDust(count = 900, area = 100, height = 22) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * area;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() - 0.5) * area;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xbfcad8, size: 0.07, transparent: true, opacity: 0.22,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.update = (dt) => {
    const a = geo.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) + dt * 0.25;
      if (y > height) y = 0;
      a.setY(i, y);
      a.setX(i, a.getX(i) + Math.sin((y + i) * 0.5) * dt * 0.06);
    }
    a.needsUpdate = true;
  };
  return pts;
}

// A soft volumetric light shaft (additive quad) angled from a window to the
// floor. Cheap fake god-ray.
export function makeShaft(width, height, color = 0xbff3e8) {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.06, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}

// ---------------------------------------------------------------------------
// Bloom + filmic grade. Bright things (windows, ticker boards, the pit mood
// lights, big-print flashes) glow, which carries most of the "dreamy" feel.
// ---------------------------------------------------------------------------
export function makeComposer(renderer, scene, camera) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight), 0.65, 0.6, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return { composer, bloom };
}
