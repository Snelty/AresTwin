// The same footprint drives the visible habitat, collision and the airlock route.
import { BASE_A, type XZ } from './terrain';
import { HABITAT_OFFSET } from './habitatLayout';
export { HABITAT_OFFSET } from './habitatLayout';

export const MODULE_DISTANCE = 5.3;
export const MODULE_ANGLE = 0.4;
const BODY_RADIUS = 0.26;

export function moduleLocal(p: XZ, i = 0): XZ {
  const a = MODULE_ANGLE + i * Math.PI * 2 / 3;
  const dx = p.x - BASE_A.x - HABITAT_OFFSET;
  const dz = p.z - BASE_A.z - HABITAT_OFFSET;
  return { x: dx * Math.cos(a) + dz * Math.sin(a) - MODULE_DISTANCE, z: -dx * Math.sin(a) + dz * Math.cos(a) };
}

export function airlockWorld(x: number, z = 0): XZ {
  return {
    x: BASE_A.x + HABITAT_OFFSET + Math.cos(MODULE_ANGLE) * (MODULE_DISTANCE + x) - Math.sin(MODULE_ANGLE) * z,
    z: BASE_A.z + HABITAT_OFFSET + Math.sin(MODULE_ANGLE) * (MODULE_DISTANCE + x) + Math.cos(MODULE_ANGLE) * z,
  };
}
// Functions rather than constants: the real terrain package assigns BASE_A at boot.
export const habitatEntrance = () => airlockWorld(5.3);
export const habitatRefuge = () => airlockWorld(0.7);

export function airlockCorridor(p: XZ) {
  const q = moduleLocal(p);
  return q.x >= -1.4 && q.x <= 5.5 && Math.abs(q.z) < 0.56;
}

export function airlockOpen(p: XZ) {
  const q = moduleLocal(p);
  return q.x > 1.2 && q.x < 5.6 && Math.abs(q.z) < 3;
}

/** Whole building footprint for the coarse planner; the narrow access is appended explicitly. */
export function habitatFootprint(p: XZ, margin = 0) {
  if (Math.hypot(p.x - BASE_A.x - HABITAT_OFFSET, p.z - BASE_A.z - HABITAT_OFFSET) < 4.17 + margin) return true;
  return [0, 1, 2].some(i => {
    const q = moduleLocal(p, i);
    return Math.abs(q.x) < 2.14 + margin && Math.abs(q.z) < 1.24 + margin;
  });
}

export function habitatSolid(p: XZ, doorOpen = airlockOpen(p)) {
  const r = BODY_RADIUS;
  if (Math.hypot(p.x - BASE_A.x - HABITAT_OFFSET, p.z - BASE_A.z - HABITAT_OFFSET) < 4.17 + r) return true;
  for (const i of [1, 2]) {
    const q = moduleLocal(p, i);
    if (Math.abs(q.x) < 1.92 + r && Math.abs(q.z) < 1.24 + r) return true;
  }
  const q = moduleLocal(p);
  // Airlock side walls, rear wall and door jambs. The only opening faces outwards.
  if (q.x > -1.9 - r && q.x < 2.14 + r && Math.abs(q.z) < 1.24 + r) {
    if (q.x < -1.72 + r || Math.abs(q.z) > 0.86 - r) return true;
    if (q.x > 1.72 - r && Math.abs(q.z) > 0.55 - r) return true;
    if (!doorOpen && q.x > 1.91 - r && q.x < 2.1 + r) return true;
  }
  return false;
}

/** Swept movement: small steps stop even the fastest walk from tunnelling through a wall. */
export function collideHabitat(from: XZ, to: XZ): XZ {
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.1));
  const dx = (to.x - from.x) / n, dz = (to.z - from.z) / n;
  const p = { ...from };
  for (let i = 0; i < n; i++) {
    const open = airlockOpen(p);
    const next = { x: p.x + dx, z: p.z + dz };
    if (!habitatSolid(next, open)) Object.assign(p, next);
    else if (!habitatSolid({ x: next.x, z: p.z }, open)) p.x = next.x;
    else if (!habitatSolid({ x: p.x, z: next.z }, open)) p.z = next.z;
  }
  return p;
}
