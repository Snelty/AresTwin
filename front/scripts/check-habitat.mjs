// Run from front/: node scripts/check-habitat.mjs
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

await mkdir('node_modules/.cache', { recursive: true });
await build({ stdin: { contents: `
export * from './src/lib/habitat'; export * from './src/sim/shelter';
export { BASE_A, TARGET_B, ROCKS, buildHeightfield, regenRocks, heightAt, meshHeightAt, applyBumps } from './src/lib/terrain';
export { costGrid, cellOf } from './src/lib/costmap';
export { demSampler, fitPlane, enuToScene } from './src/lib/realTerrain';
export { setRealSites, SITES } from './src/lib/sites';
export { initSimulation, rt, sampleRoute } from './src/store/simEngine';
export { routeGazeTarget, projectOnPolyline } from './src/vr/routeGaze';
export { initVR, vr, moveAstronaut, recalculateRoute, setDestino } from './src/vr/vrEngine';
export { bio, stepBio, bioSnapshot, applyBio, level, returnLitres } from './src/hud/bio';
export { stepHabitatShelter, executeVRCommand, escena } from './src/sim/escenario';
export { stepTemperature, temperature } from './src/sim/temperature';
export { stepNav, nav } from './src/nav/nav';
export { mission } from './src/mission/mission';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm',
  define: { 'import.meta.env': '{}' }, outfile: 'node_modules/.cache/habitat-check.mjs' });
globalThis.location = { search: process.argv.includes('--procedural') ? '?terreno=procedural' : '', pathname: '/' };
const m = await import(pathToFileURL(`${process.cwd()}/node_modules/.cache/habitat-check.mjs`));
const procedural = process.argv.includes('--procedural');
if (procedural) m.buildHeightfield();
else {
  const manifest = JSON.parse(await readFile('../terreno/manifest.json', 'utf8'));
  const sites = JSON.parse(await readFile('../terreno/sitios.json', 'utf8'));
  const bytes = await readFile('../terreno/elevacion.bin');
  const pkg = { manifest, elevacion: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
  Object.assign(m.BASE_A, m.enuToScene(manifest.habitat.x, manifest.habitat.y));
  Object.assign(m.TARGET_B, m.BASE_A);
  m.setRealSites(sites.sitios, 'paquete');
  const plane = m.fitPlane(pkg), dem = m.demSampler(pkg);
  m.buildHeightfield(null, null, 'test', { tilt: plane, real: (x, z) => dem(x, z) - plane.mean });
}
m.regenRocks([m.BASE_A, ...m.SITES], 7);
m.initSimulation({ planTour: false }); m.initVR();
const refuge = m.habitatRefuge(), entrance = m.habitatEntrance();
// Regression: planner clearance must not turn empty space around the model into a wall.
const center = { x: m.BASE_A.x + m.HABITAT_OFFSET, z: m.BASE_A.z + m.HABITAT_OFFSET };
let airTests = 0, airBlocks = 0, firstAirBlock = null, supportError = 0;
for (let x = -10; x <= 10; x += 0.4) for (let z = -10; z <= 10; z += 0.4) {
  const p = { x: center.x + x, z: center.z + z };
  if (Math.hypot(x, z) <= 9.5) supportError = Math.max(supportError,
    Math.abs(m.heightAt(p.x, p.z) - m.heightAt(center.x, center.z)),
    Math.abs(m.meshHeightAt(p.x, p.z) - m.heightAt(center.x, center.z)));
  if (m.habitatSolid(p) || Number.isFinite(m.costGrid.cost[m.cellOf(p)])) continue;
  const target = { x: p.x + 0.06, z: p.z };
  if (!m.costGrid.terrainWalkable[m.cellOf(p)] || !m.costGrid.terrainWalkable[m.cellOf(target)] || m.habitatSolid(target)) continue;
  if (m.ROCKS.some(r => Math.hypot(r.x - p.x, r.z - p.z) < r.s * 0.95 + 0.5)) continue;
  Object.assign(m.vr, p);
  m.moveAstronaut(1, 0, Math.PI / 2, false, 0.02, 3);
  airTests++;
  if (Math.hypot(m.vr.x - p.x, m.vr.z - p.z) < 0.02) { airBlocks++; firstAirBlock ??= p; }
}
console.log(JSON.stringify({ airTests, airBlocks, firstAirBlock, supportErrorMeters: supportError }));
assert.ok(airTests > 30, 'Check movement throughout the planner clearance margin');
assert.equal(airBlocks, 0, 'Empty space outside the physical habitat must remain walkable');
assert.ok(supportError < 0.015, 'All of the habitat pad must sit on the same ground level');
m.initVR();
assert.ok(!m.habitatSolid(refuge));
assert.equal(m.shelterState.inside, false, 'The old map marker outside the building is not shelter');
// A 20 m displacement must not tunnel through the airlock rear wall.
const swept = m.collideHabitat(entrance, m.airlockWorld(-15));
assert.ok(m.moduleLocal(swept).x > -1, 'The back wall stops the astronaut');
for (const side of [-1, 1]) {
  const from = m.airlockWorld(0.7, side * 4), to = m.airlockWorld(0.7);
  const hit = m.collideHabitat(from, to);
  assert.ok(Math.abs(m.moduleLocal(hit).z) > 1.2, 'Side walls are solid');
  assert.equal(m.updateShelter(hit), null, 'Touching the outside wall does not grant protection');
}
// Exercise the actual engine, terrain graph and movement, not only geometry helpers.
const starts = [m.BASE_A, m.airlockWorld(12), m.airlockWorld(10, 10), m.airlockWorld(10, -12), m.airlockWorld(2.8, 0.5)];
let routes = 0;
for (const start of starts) {
  m.shelterState.inside = false;
  Object.assign(m.vr, start); m.recalculateRoute('test return');
  assert.ok(Number.isFinite(m.vr.routeLitres), `No safe home route from ${JSON.stringify(start)}`);
  const route = m.rt.route;
  const points = Array.from({ length: route.n }, (_, i) => ({ x: route.xs[i], z: route.zs[i] }));
  assert.ok(Math.hypot(points.at(-1).x - refuge.x, points.at(-1).z - refuge.z) < 0.001);
  for (const target of points.slice(1)) {
    for (let step = 0; step < 700 && Math.hypot(target.x - m.vr.x, target.z - m.vr.z) > 0.04; step++) {
      const dx = target.x - m.vr.x, dz = target.z - m.vr.z;
      const before = { x: m.vr.x, z: m.vr.z };
      m.moveAstronaut(1, 0, Math.atan2(dx, -dz), false, 0.02, Math.min(3, Math.hypot(dx, dz) / 0.02));
      m.stepHabitatShelter();
      assert.ok(Math.hypot(m.vr.x - before.x, m.vr.z - before.z) > 0.00001,
        `Route blocked: ${JSON.stringify({ before, target, local: m.moduleLocal(before) })}`);
    }
  }
  assert.equal(m.shelterState.inside, true, 'Following the home route must enter the airlock');
  assert.equal(m.rt.route.n, 1, 'Arrival clears the escape route');
  assert.equal(m.airlockOpen(m.vr), false, 'The outer door closes after arrival');
  routes++;
}
// The headset follows short steering targets, which cut bends slightly. Verify doorway clearance.
for (const start of starts.slice(0, 4)) {
  m.shelterState.inside = false;
  Object.assign(m.vr, start); m.recalculateRoute('gaze return');
  for (let i = 0; i < 2500 && !m.shelterState.inside; i++) {
    const r = m.rt.route, projection = m.projectOnPolyline(r, m.vr.x, m.vr.z);
    const look = m.sampleRoute(r, Math.min(r.len, projection.s + 8));
    const dx = look.x - m.vr.x, dz = look.z - m.vr.z;
    const eyeY = m.heightAt(m.vr.x, m.vr.z) + 1.7;
    const yaw = Math.atan2(dx, -dz), pitch = Math.atan2(m.heightAt(look.x, look.z) + 0.05 - eyeY, Math.hypot(dx, dz));
    const steering = m.routeGazeTarget(r, { x: m.vr.x, z: m.vr.z, eyeY, yaw, pitch }, m.heightAt);
    assert.ok(steering || pitch < -25 * Math.PI / 180, 'Route gaze or floor gaze must continue toward the shelter');
    m.moveAstronaut(1, 0, steering?.yaw ?? yaw, false, 0.02, Math.min(3, (steering?.distance ?? Infinity) / 0.02));
    m.stepHabitatShelter();
  }
  assert.equal(m.shelterState.inside, true, `Gaze walking must clear the door from ${JSON.stringify(start)}`);
}
// Real cold and solar commands must remain active outdoors while the suit recovers indoors.
m.executeVRCommand({ type: 'cold' }); m.executeVRCommand({ type: 'solar-storm' });
m.bio.O2 = 12; m.bio.frost = 1; m.bio.hyp = 1;
for (let i = 0; i < 300; i++) { m.stepBio(0.1); m.stepTemperature(0.1, -20, m.bio.coldManual); }
assert.equal(m.bio.O2, 12, 'The habitat supplies air without consuming/refilling the suit tank');
assert.ok(m.bio.frost < 0.001 && m.bio.hyp < 0.001, 'Cold and hypoxia recover inside');
assert.equal(m.bio.R, 0); assert.equal(m.level(), 'ok');
assert.ok(m.temperature.temperatureC < -95, 'The outdoor scenario remains cold');
assert.equal(m.escena.spe.nivel, 'critico');
m.stepNav(0.1); assert.equal(m.nav.spe, null);
const snapshot = m.bioSnapshot(); assert.equal(snapshot.sheltered, true);
m.shelterState.inside = false; m.applyBio(snapshot); assert.equal(m.shelterState.inside, true, 'Phone receives shelter state');
// Walk out through the same door using full-speed engine steps.
for (let i = 0; i < 100 && m.shelterState.inside; i++) {
  const dx = entrance.x - m.vr.x, dz = entrance.z - m.vr.z;
  m.moveAstronaut(1, 0, Math.atan2(dx, -dz), false, 0.05, 10); m.stepHabitatShelter();
}
assert.equal(m.shelterState.inside, false, 'Leaving the airlock removes protection');
for (let i = 0; i < 100; i++) m.stepBio(0.1);
assert.ok(m.bio.O2 < 12 && m.bio.frost > 0.8, 'Outdoor exposure and tank consumption resume');
m.stepNav(0.1); assert.equal(m.nav.spe, 'critico');
assert.equal(m.bioSnapshot().sheltered, false);
// A completely empty suit tank is safe indoors, and dangerous again outside.
Object.assign(m.vr, refuge); m.stepHabitatShelter(); m.bio.O2 = 0;
for (let i = 0; i < 200; i++) m.stepBio(0.1);
assert.equal(m.level(), 'ok'); assert.ok(m.bio.hyp < 0.001);
m.applyBio({ ...snapshot, sheltered: false }); assert.equal(m.shelterState.inside, false);
// A new destination from the side of the interior must also route through the narrow door.
m.escena.spe = null;
Object.assign(m.vr, m.airlockWorld(0.7, 0.5)); m.stepHabitatShelter();
m.setDestino(m.BASE_A.x + 20, m.BASE_A.z + 20);
const outbound = m.rt.route;
for (let i = 1; i < outbound.n && m.shelterState.inside; i++) {
  const target = { x: outbound.xs[i], z: outbound.zs[i] };
  for (let j = 0; j < 500 && Math.hypot(target.x - m.vr.x, target.z - m.vr.z) > 0.04; j++) {
    const dx = target.x - m.vr.x, dz = target.z - m.vr.z;
    const before = { x: m.vr.x, z: m.vr.z };
    m.moveAstronaut(1, 0, Math.atan2(dx, -dz), false, 0.02, Math.min(3, Math.hypot(dx, dz) / 0.02));
    m.stepHabitatShelter();
    assert.ok(Math.hypot(m.vr.x - before.x, m.vr.z - before.z) > 0.00001, 'The outbound route must clear the jamb');
  }
}
assert.equal(m.shelterState.inside, false);
// Terrain edits must preserve the foundation too, while still raising the ground beyond it.
const supportHeight = m.heightAt(center.x, center.z);
const hill = { x: center.x + 16, z: center.z, h: 12, r: 10 };
const oldHillHeight = m.heightAt(hill.x, hill.z);
m.applyBumps([hill]);
for (let a = 0; a < Math.PI * 2; a += 0.1) {
  assert.ok(Math.abs(m.meshHeightAt(center.x + Math.cos(a) * 9.5, center.z + Math.sin(a) * 9.5) - supportHeight) < 0.015,
    'Scenario hills must leave the foundation supported');
}
assert.ok(m.heightAt(hill.x, hill.z) - oldHillHeight > 10, 'Terrain events remain active beyond the foundation');
m.applyBumps([]);
console.log(`PASS (${procedural ? 'procedural' : 'real DEM'}): no phantom collisions, grounded foundation, terrain edits, ${routes} return routes, solid walls, entry/exit, indoor air, cold recovery, persistent outdoor storm and phone synchronization`);
