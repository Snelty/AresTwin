// Headset simulation for the VPS-only build. The local paired headset continues to use its host.
import { EYE_HEIGHT, moveAstronaut, recalculateRoute, stepDrone, updateBody, vr } from './vrEngine';
import { heightAt } from '../lib/terrain';
import { groundTempC } from '../lib/marsTime';
import { rt } from '../store/simEngine';
import { bio, stepBio } from '../hud/bio';
import { stepNav } from '../nav/nav';
import { stepEscena, stepHabitatShelter } from '../sim/escenario';
import { stepTemperature } from '../sim/temperature';
import { shelterState } from '../sim/shelter';
import { suitState } from './suit/state';
import { createRouteGazeState, stepRouteGaze } from './routeGaze';
import { walkingSegmentClear } from '../lib/walking';

export const soloWalk = { walking: false, speed: 3, ramp: 0 };
export const createSoloController = () => ({ route: createRouteGazeState(), blocked: 0, cooldown: 0, exitArmed: false });

export function stepSoloPlayer(control: ReturnType<typeof createSoloController>, dtRaw: number, yaw: number, pitch: number, keys: Set<string>, stick?: { fwd: number; strafe: number }) {
  if (!vr.ready) return;
  const dt = Math.min(dtRaw, 0.05);
  const keyboardFwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const keyboardStrafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const keyboard = keyboardFwd !== 0 || keyboardStrafe !== 0;
  const fwd = keyboard ? keyboardFwd : stick?.fwd ?? 0;
  const strafe = keyboard ? keyboardStrafe : stick?.strafe ?? 0;
  const manual = fwd !== 0 || strafe !== 0;
  // Arrival stops the headset. Looking up and then down re-arms walking so it can leave unaided.
  if (!shelterState.inside) control.exitArmed = false;
  else if (pitch > -15 * Math.PI / 180) control.exitArmed = true;
  const canAuto = !stick && !manual && (!shelterState.inside || control.exitArmed);
  const target = stepRouteGaze(control.route, rt.route, { x: vr.x, z: vr.z, eyeY: heightAt(vr.x, vr.z) + EYE_HEIGHT, yaw, pitch }, heightAt, canAuto, dt, walkingSegmentClear);
  const ground = canAuto && !control.route.blocked && -pitch * 180 / Math.PI > 25 ? Math.min(1, (-pitch * 180 / Math.PI - 25) / 8) : 0;
  const want = target ? 1 : ground;
  if (!want) soloWalk.ramp = 0;
  else soloWalk.ramp += (want - soloWalk.ramp) * (1 - Math.exp(-dt * 6));
  soloWalk.walking = want > 0 && soloWalk.ramp > 0.05;
  if (soloWalk.walking) moveAstronaut(1, 0, target?.yaw ?? yaw, false, dt, Math.min(soloWalk.speed * soloWalk.ramp, target ? target.distance / dt : Infinity));
  else moveAstronaut(fwd, strafe, yaw, keys.has('ShiftLeft') || keys.has('ShiftRight'), dt,
    stick && !keyboard ? soloWalk.speed * Math.min(1, Math.hypot(fwd, strafe)) : undefined);
  if (stick) soloWalk.walking = vr.speed > 0.1;
  control.cooldown = Math.max(0, control.cooldown - dt);
  control.blocked = canAuto && (control.route.blocked || (target && vr.speed < 0.08)) ? control.blocked + dt : 0;
  if (control.blocked > 0.8 && control.cooldown === 0) {
    recalculateRoute('rodear obstáculo'); control.blocked = 0; control.cooldown = 2;
  }
  suitState.lookYaw = yaw; suitState.lookPitch = pitch;
  updateBody(yaw, dt); stepDrone(dt); stepHabitatShelter();
  stepBio(dt); stepEscena(dt); stepNav(dt);
  stepTemperature(dt, groundTempC(rt.sun.ltst, rt.lat, rt.mars.decl, rt.mars.rAU), bio.coldManual);
}
