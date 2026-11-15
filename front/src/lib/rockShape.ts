import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three-stdlib';
import { mulberry32 } from './noise';
import { heightAt } from './terrain';
import { Q } from '../render/quality';

// --- 3D value noise ---------------------------------------------------------
export function hash3(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}
function fbm3(x: number, y: number, z: number, oct: number) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += noise3(x, y, z) * a;
    n += a;
    a *= 0.5;
    x *= 2.03; y *= 2.03; z *= 2.03;
  }
  return s / n;
}

/**
 * A boulder about one unit in radius, flat and buried below y = −0.25 (the ground line).
 * `kind` picks the family: 0 blocky fractured rock, 1 layered slab, 2 rounded, wind-worn boulder.
 */
export function makeRockGeometry(seed: number, detail: number, kind = seed % 3): THREE.BufferGeometry {
  const rng = mulberry32(seed * 7919 + 13);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const ox = rng() * 50, oy = rng() * 50, oz = rng() * 50;
  // Fracture planes. Blocky rocks get many deep cuts; slabs get bedding planes (flat top, stepped sides).
  const planes: [number, number, number, number][] = [];
  const count = kind === 2 ? 3 + Math.floor(rng() * 3) : 8 + Math.floor(rng() * 6);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const y = kind === 1 ? (rng() - 0.5) * 0.35 : -0.3 + rng() * 1.25;
    const h = Math.sqrt(Math.max(0, 1 - Math.min(1, y) ** 2));
    const n = new THREE.Vector3(Math.cos(a) * h, Math.min(1, y), Math.sin(a) * h).normalize();
    planes.push([n.x, n.y, n.z, (kind === 2 ? 0.7 : 0.5) + rng() * 0.36]);
  }
  if (kind === 1) {
    const tilt = new THREE.Vector3((rng() - 0.5) * 0.3, 1, (rng() - 0.5) * 0.3).normalize();
    planes.push([tilt.x, tilt.y, tilt.z, 0.3 + rng() * 0.16]);
  }
  const cut = kind === 2 ? 0.6 : 0.86;
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const r = 0.8 + 0.42 * fbm3(v.x * 1.3 + ox, v.y * 1.3 + oy, v.z * 1.3 + oz, 3) + 0.08 * fbm3(v.x * 4.2 + oz, v.y * 4.2 + ox, v.z * 4.2 + oy, 2);
    v.multiplyScalar(r);
    for (const [nx, ny, nz, o] of planes) {
      const t = v.x * nx + v.y * ny + v.z * nz - o;
      if (t > 0) v.addScaledVector(_n.set(nx, ny, nz), -t * cut);
    }
    if (kind === 1) {
      // Bedding: the sides step in and out along thin layers.
      const layer = Math.sin(v.y * 26 + ox) * 0.5 + 0.5;
      const k = 1 + 0.045 * (layer > 0.55 ? 1 : -1) * Math.min(1, Math.hypot(v.x, v.z) * 2);
      v.x *= k;
      v.z *= k;
    }
    // Faces are never truly flat: a slow warp after the cuts, then small-scale chipping.
    v.multiplyScalar(1 + 0.16 * (fbm3(v.x * 2.1 + oy, v.y * 2.1 + oz, v.z * 2.1 + ox, 2) - 0.5) + 0.05 * (noise3(v.x * 9 + ox, v.y * 9 + oy, v.z * 9 + oz) - 0.5));
    if (v.y > 0) v.y *= kind === 1 ? 0.62 : 0.8; // squat: wider than tall
    if (v.y < -0.5) v.y = -0.5 - (-0.5 - v.y) * 0.12; // flat, buried base
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // Bring every variant back to about one unit across.
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const k = 2 / Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  g.scale(k, Math.min(1.25, k), k);
  // Hard edges where the fracture faces meet, smooth shading within each face.
  g = toCreasedNormals(g, kind === 2 ? 1.0 : 0.7);
  g.computeBoundingSphere();
  return g;
}
const _n = new THREE.Vector3();

export interface RockLike { x: number; z: number; s: number; sy?: number; rot: number }
export const ROCK_VARIANTS = 6;
export const BIG_ROCK = 0.8;
let variants: { hi: THREE.BufferGeometry; lo: THREE.BufferGeometry }[] | null = null;
export function rockVariants() {
  return variants ??= Array.from({ length: ROCK_VARIANTS }, (_, i) => ({
    hi: makeRockGeometry(i + 1, Q.rockDetail), lo: makeRockGeometry(i + 1, Math.max(2, Q.rockDetail - 2)),
  }));
}

const rockEuler = new THREE.Euler(), rockQuaternion = new THREE.Quaternion();
const rockPosition = new THREE.Vector3(), rockScale = new THREE.Vector3();
/** Shared by rendering and collision, including the deterministic tilt and nonuniform scale. */
export function composeRockMatrix(r: RockLike, out: THREE.Matrix4) {
  const sy = r.sy ?? 0.8;
  const k = hash3(Math.round(r.x * 10), 7, Math.round(r.z * 10));
  rockEuler.set((k - 0.5) * 0.3, r.rot, (hash3(Math.round(r.x * 10), 3, Math.round(r.z * 10)) - 0.5) * 0.3);
  rockQuaternion.setFromEuler(rockEuler);
  rockPosition.set(r.x, heightAt(r.x, r.z) + r.s * sy * 0.25, r.z);
  rockScale.set(r.s, r.s * sy, r.s * 0.9);
  return out.compose(rockPosition, rockQuaternion, rockScale);
}

