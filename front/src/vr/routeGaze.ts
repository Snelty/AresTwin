import { sampleRoute, type Route } from '../store/simEngine';

/** Closest point on the polyline, shared with deviation/replanning checks. */
export function projectOnPolyline(r: Route, px: number, pz: number): { dist: number; s: number } {
  if (r.n < 2) return { dist: Infinity, s: 0 };
  let dist = Infinity, s = 0;
  for (let i = 0; i < r.n - 1; i++) {
    const ax = r.xs[i], az = r.zs[i];
    const dx = r.xs[i + 1] - ax, dz = r.zs[i + 1] - az;
    const length2 = dx * dx + dz * dz;
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length2)) : 0;
    const distance = Math.hypot(px - ax - t * dx, pz - az - t * dz);
    if (distance < dist) { dist = distance; s = r.cum[i] + Math.sqrt(length2) * t; }
  }
  return { dist, s };
}

export interface GazePose { x: number; z: number; eyeY: number; yaw: number; pitch: number }
type CanWalk = (from: { x: number; z: number }, to: { x: number; z: number }) => boolean;

/** Looking along the next metres of the route enables a short, curve-following step. */
export function routeGazeTarget(r: Route, pose: GazePose, height: (x: number, z: number) => number, following = false, canWalk?: CanWalk): { yaw: number; distance: number } | null {
  if (r.n < 2 || r.len < 0.25 || pose.pitch > 15 * Math.PI / 180 || pose.pitch < -Math.PI / 3) return null;
  const projection = projectOnPolyline(r, pose.x, pose.z);
  if (projection.dist > 3.5 || r.len - projection.s < 0.25) return null;
  const point = { x: 0, z: 0 };
  let lookingAtRoute = false;
  // Dense samples avoid gaps between the old four aim points, especially over uneven slopes.
  for (let ahead = 2; ahead <= 18; ahead += 0.5) {
    sampleRoute(r, Math.min(r.len, projection.s + ahead), point);
    const dx = point.x - pose.x, dz = point.z - pose.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.15) continue;
    const yaw = Math.atan2(dx, -dz);
    const yawError = Math.atan2(Math.sin(yaw - pose.yaw), Math.cos(yaw - pose.yaw));
    const pitch = Math.atan2(height(point.x, point.z) + 0.05 - pose.eyeY, distance);
    if (Math.abs(yawError) <= (following ? 28 : 18) * Math.PI / 180 && Math.abs(pitch - pose.pitch) <= (following ? 18 : 12) * Math.PI / 180) {
      lookingAtRoute = true; break;
    }
  }
  if (!lookingAtRoute) return null;
  // A short target follows bends instead of cutting straight across the terrain.
  for (const ahead of [1.2, 0.8, 0.4, 0.15, 0]) {
    sampleRoute(r, Math.min(r.len, projection.s + ahead), point);
    const dx = point.x - pose.x, dz = point.z - pose.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.05 && (!canWalk || canWalk(pose, point))) return { yaw: Math.atan2(dx, -dz), distance };
  }
  return null;
}

export const createRouteGazeState = () => ({ seconds: 0, following: false, blocked: false });
/** Wider release angles absorb head jitter. Aligned replans retain the active walk. */
export function stepRouteGaze(state: ReturnType<typeof createRouteGazeState>, r: Route, pose: GazePose,
  height: (x: number, z: number) => number, enabled: boolean, dt: number, canWalk?: CanWalk) {
  const aimed = enabled ? routeGazeTarget(r, pose, height, state.following) : null;
  state.blocked = false;
  if (!aimed) { state.seconds = 0; state.following = false; return null; }
  state.seconds += dt;
  state.following ||= state.seconds >= 0.3;
  if (!state.following) return null;
  const target = canWalk ? routeGazeTarget(r, pose, height, true, canWalk) : aimed;
  state.blocked = !target;
  return target;
}
