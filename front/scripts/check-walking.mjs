// Run from front/: node scripts/check-walking.mjs
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
await mkdir('node_modules/.cache', { recursive: true });
await build({ stdin: { loader: 'ts', resolveDir: process.cwd(), contents: `
export * from './src/lib/rockCollision'; export * from './src/lib/walking';
export * from './src/vr/routeGaze';
export { BASE_A, TARGET_B, ROCKS, buildHeightfield, regenRocks, heightAt } from './src/lib/terrain';
export { demSampler, fitPlane, enuToScene } from './src/lib/realTerrain';
export { setRealSites, SITES } from './src/lib/sites';
export { computeCostmap, costGrid, cellOf } from './src/lib/costmap';
export { planAStar } from './src/lib/pathfinding';
export { makeRoute, sampleRoute } from './src/store/simEngine';
export { vr, moveAstronaut } from './src/vr/vrEngine';
` }, bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, outfile: 'node_modules/.cache/walking-check.mjs' });
globalThis.location = { search: '?q=medium', pathname: '/' };
const m = await import(pathToFileURL(`${process.cwd()}/node_modules/.cache/walking-check.mjs`));
m.buildHeightfield(null, null, 'flat test', { real: () => 0 });
m.ROCKS.splice(0, m.ROCKS.length, ...Array.from({ length: 6 }, (_, i) => ({ x: 20 + i * 12, z: 20, s: i ? 0.95 + i * 0.15 : 0.7, sy: 0.6, rot: i * 0.7 })));
m.ROCKS.push({ x: 20, z: -20, s: 0.08, sy: 0.5, rot: 0 });
m.computeCostmap([], true);
let recoveredAir = 0, probes = 0;
for (const rock of m.ROCKS.slice(0, 6)) {
  for (let a = 0; a < Math.PI * 2; a += 0.08) for (const d of [0.65, 0.8, 1, 1.2, 1.5, 1.8, 2.2, 2.6, 3]) {
    const p = { x: rock.x + Math.cos(a) * d, z: rock.z + Math.sin(a) * d };
    const to = { x: p.x + 0.03, z: p.z };
    if (!m.walkingSegmentClear(p, to)) continue;
    Object.assign(m.vr, p, { goals: [] });
    m.moveAstronaut(1, 0, Math.PI / 2, false, 0.01, 3);
    assert.ok(Math.hypot(m.vr.x - to.x, m.vr.z - to.z) < 0.001, 'Empty space near a rock must remain walkable');
    probes++;
    if (!Number.isFinite(m.costGrid.cost[m.cellOf(p)])) recoveredAir++;
  }
}
assert.ok(probes > 300 && recoveredAir > 100);
let connectedStarts = 0;
for (const rock of m.ROCKS.slice(0, 3)) for (let a = 0; a < Math.PI * 2; a += 0.35) {
  const start = { x: rock.x + Math.cos(a) * (rock.s + 0.35), z: rock.z + Math.sin(a) * (rock.s + 0.35) };
  if (m.rockSolid(start)) continue;
  const result = m.planAStar(start, { x: rock.x + 6, z: rock.z + 8 });
  assert.ok(result.ok);
  assert.ok(result.points.every((p, i) => !i || m.walkingSegmentClear(result.points[i - 1], p)),
    `A replan beside a rock must connect the astronaut without crossing it: ${JSON.stringify(start)}`);
  connectedStarts++;
}
assert.ok(m.walkingSegmentClear({ x: 19, z: -20 }, { x: 21, z: -20 }), 'Ankle-high pebbles can be stepped over');
const hit = m.moveWithCollisions({ x: 10, z: 20 }, { x: 30, z: 20 });
assert.ok(hit.x < 20 && !m.rockSolid(hit), 'Fast movement cannot tunnel through a visible rock');
const field = { id: 'test', kind: 'rocks', x: 60, z: -30, r: 8, rocks: [{ x: 62, z: -30, s: 1.5, rot: 0 }] };
m.computeCostmap([field], true);
assert.ok(!Number.isFinite(m.costGrid.cost[m.cellOf({ x: 55, z: -30 })]));
assert.ok(m.walkingSegmentClear({ x: 54, z: -30 }, { x: 56, z: -30 }), 'A rock-field circle must not create an invisible wall between its stones');
assert.ok(!m.rocksSegmentClear({ x: 60, z: -30 }, { x: 64, z: -30 }), 'The actual rock inside the field is solid');
m.computeCostmap([], true);

const flat = () => 0, pose = { x: 0, z: 0, eyeY: 1.7, yaw: 0, pitch: -0.12 };
const north = m.makeRoute([{ x: 0, z: 0 }, { x: 0, z: -30 }]), control = m.createRouteGazeState();
for (let i = 0; i < 20; i++) m.stepRouteGaze(control, north, pose, flat, true, 0.02);
assert.equal(control.following, true);
for (const deg of [17, 21, 26, 19, 24, 17]) assert.ok(m.stepRouteGaze(control, north, { ...pose, yaw: deg * Math.PI / 180 }, flat, true, 0.02), 'Head jitter must not restart the dwell');
const replan = m.makeRoute([{ x: 0, z: 0 }, { x: 0.1, z: -30 }]);
assert.ok(m.stepRouteGaze(control, replan, pose, flat, true, 0.02), 'An aligned replan must preserve active walking');
assert.equal(m.stepRouteGaze(control, replan, { ...pose, yaw: Math.PI / 2 }, flat, true, 0.02), null, 'Looking away stops immediately');
assert.equal(control.following, false);
for (let i = 0; i < 20; i++) m.stepRouteGaze(control, north, pose, flat, true, 0.02);
assert.equal(m.stepRouteGaze(control, north, pose, flat, false, 0.02), null, 'Manual controls cancel gaze walking');
for (let i = 0; i < 20; i++) m.stepRouteGaze(control, north, pose, flat, true, 0.02);
assert.equal(m.stepRouteGaze(control, north, pose, flat, true, 0.02, () => false), null);
assert.equal(control.blocked, true, 'An obstructed steering step requests a replan rather than walking into the rock');
assert.equal(control.following, true, 'Keep the route intent during obstacle recovery');
assert.equal(m.stepRouteGaze(control, north, { ...pose, yaw: Math.PI / 2 }, flat, true, 0.02), null);
assert.equal(control.blocked, false, 'Looking away cancels obstacle recovery');

function follow(start, goal, label) {
  Object.assign(m.vr, start, { goals: [] });
  const result = m.planAStar(start, goal);
  assert.equal(result.ok, true, `${label}: route exists`);
  const route = m.makeRoute(result.points), state = m.createRouteGazeState();
  let stalled = 0, frames = 0;
  for (; frames < 7000 && Math.hypot(m.vr.x - goal.x, m.vr.z - goal.z) > 0.3; frames++) {
    const projection = m.projectOnPolyline(route, m.vr.x, m.vr.z);
    const look = m.sampleRoute(route, Math.min(route.len, projection.s + 8));
    const dx = look.x - m.vr.x, dz = look.z - m.vr.z, distance = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, -dz), eyeY = m.heightAt(m.vr.x, m.vr.z) + 1.7;
    const pitch = Math.atan2(m.heightAt(look.x, look.z) + 0.05 - eyeY, distance);
    const target = m.stepRouteGaze(state, route, { x: m.vr.x, z: m.vr.z, eyeY, yaw, pitch }, m.heightAt, true, 0.05, m.walkingSegmentClear);
    const floor = pitch < -25 * Math.PI / 180;
    if (!target && !floor) { assert.ok(frames < 8, `${label}: gaze lost the route at ${JSON.stringify({ x: m.vr.x, z: m.vr.z, projection })}`); continue; }
    const before = { x: m.vr.x, z: m.vr.z };
    m.moveAstronaut(1, 0, target?.yaw ?? yaw, false, 0.05, Math.min(3, (target?.distance ?? distance) / 0.05));
    stalled = Math.hypot(m.vr.x - before.x, m.vr.z - before.z) < 0.001 ? stalled + 1 : 0;
    assert.ok(stalled < 12, `${label}: stuck at ${JSON.stringify({ before, projection, target })}`);
  }
  assert.ok(frames < 7000, `${label}: must reach the destination`);
  return frames;
}
const flatFrames = follow({ x: 12, z: 20 }, { x: 28, z: 20 }, 'medium rock on route');

const manifest = JSON.parse(await readFile('../terreno/manifest.json', 'utf8'));
const sites = JSON.parse(await readFile('../terreno/sitios.json', 'utf8'));
const bytes = await readFile('../terreno/elevacion.bin');
const pkg = { manifest, elevacion: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
Object.assign(m.BASE_A, m.enuToScene(manifest.habitat.x, manifest.habitat.y)); Object.assign(m.TARGET_B, m.BASE_A);
m.setRealSites(sites.sitios, 'paquete');
const plane = m.fitPlane(pkg), dem = m.demSampler(pkg);
m.buildHeightfield(null, null, 'real test', { tilt: plane, real: (x, z) => dem(x, z) - plane.mean });
m.regenRocks([m.BASE_A, ...m.SITES], 7);
const t = performance.now(); m.computeCostmap([], true);
const mapMs = Math.round(performance.now() - t);
const realFrames = [];
for (const site of m.SITES.slice(0, 6)) realFrames.push(follow(m.BASE_A, site, site.code));
console.log(JSON.stringify({ passed: 'mesh collision, no grid halos, small stones, tunnelling, hazard-field gaps, gaze jitter, aligned replans, immediate manual/side stops, flat and real route following', probes, recoveredAir, connectedStarts, flatFrames, realFrames, mapMs }));
