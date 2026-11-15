import { moduleLocal } from '../lib/habitat';
import type { XZ } from '../lib/terrain';

export const shelterState = { inside: false };
export const HABITAT_TEMPERATURE_C = 22;

/** Hysteresis keeps the state stable at the threshold. Protection starts behind the outer door. */
export function updateShelter(p: XZ): 'entered' | 'exited' | null {
  const q = moduleLocal(p);
  const inside = shelterState.inside
    ? q.x > -1.5 && q.x < 2.5 && Math.abs(q.z) < 0.9
    : q.x > -1.4 && q.x < 1.15 && Math.abs(q.z) < 0.58;
  if (inside === shelterState.inside) return null;
  shelterState.inside = inside;
  return inside ? 'entered' : 'exited';
}
