// Collision follows the same mesh variants and transforms as RockInstances, above ankle height.
import { Matrix4, Vector3 } from 'three';
import { ROCKS, heightAt, type XZ } from './terrain';
import { BIG_ROCK, ROCK_VARIANTS, composeRockMatrix, rockVariants, type RockLike } from './rockShape';
import type { Hazard } from './costmap';

export const WALKER_RADIUS = 0.26;
export const STEP_HEIGHT = 0.22;
interface Collider { hull: XZ[]; minX: number; maxX: number; minZ: number; maxZ: number }
let colliders: Collider[] = [];
const bins = new Map<string, number[]>();
const BIN = 5;
let seen = new Uint32Array(0), query = 0;
export const getRockColliders = () => colliders;

const cross = (a: XZ, b: XZ, c: XZ) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
function convexHull(points: XZ[]) {
  points.sort((a, b) => a.x - b.x || a.z - b.z);
  const half = (list: XZ[]) => {
    const out: XZ[] = [];
    for (const p of list) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], p) <= 1e-10) out.pop();
      out.push(p);
    }
    out.pop(); return out;
  };
  return [...half(points), ...half(points.slice().reverse())];
}

/** Rebuilt with the costmap, after terrain edits and changes to rock fields. */
export function rebuildRockColliders(hazards: Hazard[]) {
  colliders = []; bins.clear();
  const shapes = rockVariants(), matrix = new Matrix4(), vertex = new Vector3();
  const add = (rocks: RockLike[]) => rocks.forEach((r, i) => {
    const shape = shapes[i % ROCK_VARIANTS][r.s >= BIG_ROCK ? 'hi' : 'lo'];
    const positions = shape.getAttribute('position');
    composeRockMatrix(r, matrix);
    const ground = heightAt(r.x, r.z), points: XZ[] = [];
    for (let j = 0; j < positions.count; j++) {
      vertex.fromBufferAttribute(positions, j).applyMatrix4(matrix);
      if (vertex.y >= ground + STEP_HEIGHT) points.push({ x: vertex.x, z: vertex.z });
    }
    if (points.length < 3) return; // ankle-high stones can be stepped over
    const hull = convexHull(points);
    if (hull.length < 3) return;
    const xs = hull.map(p => p.x), zs = hull.map(p => p.z);
    const c = { hull, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    const id = colliders.length; colliders.push(c);
    for (let x = Math.floor(c.minX / BIN); x <= Math.floor(c.maxX / BIN); x++)
      for (let z = Math.floor(c.minZ / BIN); z <= Math.floor(c.maxZ / BIN); z++) {
        const key = `${x}:${z}`, list = bins.get(key);
        if (list) list.push(id); else bins.set(key, [id]);
      }
  });
  add(ROCKS);
  for (const h of hazards) if (h.kind === 'rocks') add(h.rocks ?? []);
  seen = new Uint32Array(colliders.length); query = 0;
}

function pointDistanceSq(p: XZ, a: XZ, b: XZ) {
  const dx = b.x - a.x, dz = b.z - a.z, len = dx * dx + dz * dz;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len)) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.z - a.z - t * dz) ** 2;
}

function segmentsDistanceSq(a: XZ, b: XZ, c: XZ, d: XZ) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return 0;
  return Math.min(pointDistanceSq(a, c, d), pointDistanceSq(b, c, d), pointDistanceSq(c, a, b), pointDistanceSq(d, a, b));
}

/** Swept suited-body clearance, used both by A* edges and actual walking. */
export function rocksSegmentClear(a: XZ, b: XZ, radius = WALKER_RADIUS) {
  if (++query === 0xffffffff) { seen.fill(0); query = 1; }
  const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius;
  const minZ = Math.min(a.z, b.z) - radius, maxZ = Math.max(a.z, b.z) + radius;
  for (let x = Math.floor(minX / BIN); x <= Math.floor(maxX / BIN); x++)
    for (let z = Math.floor(minZ / BIN); z <= Math.floor(maxZ / BIN); z++) {
      const list = bins.get(`${x}:${z}`);
      if (!list) continue;
      for (const id of list) {
        if (seen[id] === query) continue;
        seen[id] = query;
        const c = colliders[id];
        if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
        let aInside = true, bInside = true;
        for (let i = 0; i < c.hull.length; i++) {
          const p = c.hull[i], q = c.hull[(i + 1) % c.hull.length];
          aInside &&= cross(p, q, a) >= 0;
          bInside &&= cross(p, q, b) >= 0;
          if (segmentsDistanceSq(a, b, p, q) < radius * radius - 1e-8) return false;
        }
        if (aInside || bInside) return false;
      }
    }
  return true;
}

export const rockSolid = (p: XZ) => !rocksSegmentClear(p, p);
