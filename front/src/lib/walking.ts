import { cellOf, costGrid } from './costmap';
import { airlockOpen, habitatSolid } from './habitat';
import { rocksSegmentClear } from './rockCollision';
import type { XZ } from './terrain';

/** Actual body clearance. The planner's larger blocked cells never act as invisible walls. */
export function walkingSegmentClear(from: XZ, to: XZ) {
  if (!rocksSegmentClear(from, to)) return false;
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.15));
  const doorOpen = airlockOpen(from);
  for (let i = 0; i <= n; i++) {
    const p = { x: from.x + (to.x - from.x) * i / n, z: from.z + (to.z - from.z) * i / n };
    if (!costGrid.terrainWalkable[cellOf(p)] || habitatSolid(p, doorOpen)) return false;
  }
  return true;
}

/** Sweep small steps and slide along contact instead of pushing the astronaut away from a rock. */
export function moveWithCollisions(from: XZ, to: XZ) {
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.08));
  const dx = (to.x - from.x) / n, dz = (to.z - from.z) / n, p = { ...from };
  for (let i = 0; i < n; i++) {
    const next = { x: p.x + dx, z: p.z + dz };
    if (walkingSegmentClear(p, next)) Object.assign(p, next);
    else if (Math.abs(dx) > 1e-8 && walkingSegmentClear(p, { x: next.x, z: p.z })) p.x = next.x;
    else if (Math.abs(dz) > 1e-8 && walkingSegmentClear(p, { x: p.x, z: next.z })) p.z = next.z;
  }
  return p;
}
