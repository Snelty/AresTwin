import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { io as client } from 'socket.io-client';
import { attachSync } from '../sync-core.js';

async function checkServer(solo) {
  const server = createServer(), io = attachSync(server, { solo, log: () => {} }), sockets = [];
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const ack = (s, event, value) => new Promise((resolve, reject) => s.timeout(1500).emit(event, value, (e, r) => e ? reject(e) : resolve(r)));
  async function join(role) {
    const s = client(url, { transports: ['websocket'], reconnection: false, forceNew: true, autoConnect: false }); sockets.push(s);
    await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); s.connect(); });
    const ready = new Promise(resolve => s.once(solo ? 'session' : 'state', resolve));
    s.emit('register', role); await ready; await ack(s, 'ping-ares', 1); return s;
  }
  try {
    const a = await join('spectator-host'), b = await join('vr-client'), c = await join('vr-client');
    if (solo) {
      const received = [];
      for (const s of [b, c]) for (const event of ['state', 'pose', 'rotation', 'world', 'hud', 'vr-command']) s.on(event, () => received.push(event));
      a.emit('position', { x: 23, y: 1, z: 45, bio: { o2: 1 }, temperature: { cold: true, thermal: true, baselineC: -20, temperatureC: -100 } });
      a.emit('world', { routeId: 20, route: [[1, 2]], hazards: [] }); a.emit('hud', { jarvis: false });
      b.emit('rotation', [0, 1, 0, 0]); b.emit('position', { x: -20, y: 0, z: -30 });
      assert.deepEqual(await ack(b, 'vr-command', { type: 'cold' }), { ok: false, reason: 'local-only' });
      await new Promise(r => setTimeout(r, 150));
      assert.deepEqual(received, [], 'VPS visitors must never receive each other’s movement, HUD, world or commands');
      assert.equal(await ack(c, 'ping-ares', 123), 123);
      await join('spectator-host');
      assert.deepEqual(received, [], 'Late joins must not expose a shared game snapshot');
    } else {
      const pose = new Promise(resolve => b.once('pose', resolve));
      a.emit('position', { x: 23, y: 1, z: 45, heading: 0 }); assert.equal((await pose).x, 23);
      const rotation = new Promise(resolve => a.once('rotation', resolve));
      b.emit('rotation', [0, 1, 0, 0]); assert.deepEqual(await rotation, [0, 1, 0, 0]);
      a.on('vr-command', (command, reply) => reply({ ok: command.type === 'cold' }));
      assert.deepEqual(await ack(b, 'vr-command', { type: 'cold' }), { ok: true });
    }
  } finally { sockets.forEach(s => s.disconnect()); await new Promise(r => io.close(r)); }
}
await checkServer(true); await checkServer(false);

await mkdir('node_modules/.cache', { recursive: true });
const source = `export {VPS_SOLO} from './src/lib/deployment'; export {createSoloController,stepSoloPlayer,soloWalk} from './src/vr/soloPlayer'; export {mobileStick,joystickVector,resetMobileStick} from './src/mobile/joystick'; export {BASE_A,buildHeightfield} from './src/lib/terrain'; export {habitatEntrance} from './src/lib/habitat'; export {initSimulation,rt,sampleRoute} from './src/store/simEngine'; export {initVR,vr} from './src/vr/vrEngine'; export {bio} from './src/hud/bio'; export {executeVRCommand,escena} from './src/sim/escenario'; export {temperature} from './src/sim/temperature'; export {shelterState} from './src/sim/shelter'; export {projectOnPolyline} from './src/vr/routeGaze';`;
for (const solo of [false, true]) {
  await build({ stdin: { contents: source, loader: 'ts', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm',
    define: { 'import.meta.env': JSON.stringify(solo ? { VITE_VPS_SOLO: '1' } : {}) }, outfile: `node_modules/.cache/solo-${solo}.mjs` });
}
const normal = await import(pathToFileURL(`${process.cwd()}/node_modules/.cache/solo-false.mjs`)); assert.equal(normal.VPS_SOLO, false);
const url = pathToFileURL(`${process.cwd()}/node_modules/.cache/solo-true.mjs`).href;
const a = await import(url + '?device=a'), b = await import(url + '?device=b');
for (const m of [a, b]) { assert.equal(m.VPS_SOLO, true); m.buildHeightfield(null, null, 'test', { real: () => 0 }); m.initSimulation({ planTour: false }); m.initVR(); }
const bStart = { x: b.vr.x, z: b.vr.z, o2: b.bio.O2 };
const ctrl = a.createSoloController();
for (let i = 0; i < 60; i++) a.stepSoloPlayer(ctrl, 0.05, Math.PI / 2, 0, new Set(['KeyW']));
assert.ok(a.vr.x > a.BASE_A.x + 1);
assert.deepEqual({ x: b.vr.x, z: b.vr.z, o2: b.bio.O2 }, bStart, 'One device cannot move or consume oxygen for another');
a.executeVRCommand({ type: 'cold' }); a.executeVRCommand({ type: 'solar-storm' }); a.executeVRCommand({ type: 'thermal-view' });
for (let i = 0; i < 120; i++) a.stepSoloPlayer(ctrl, 0.05, 0, 0, new Set());
assert.equal(a.bio.coldManual, true); assert.equal(b.bio.coldManual, false);
assert.equal(a.temperature.thermal, true); assert.equal(b.temperature.thermal, false);
assert.equal(a.escena.spe.nivel, 'critico'); assert.equal(b.escena.spe, null);
const own = b.createSoloController();
for (let i = 0; i < 1500 && !b.shelterState.inside; i++) {
  const projection = b.projectOnPolyline(b.rt.route, b.vr.x, b.vr.z), look = b.sampleRoute(b.rt.route, Math.min(b.rt.route.len, projection.s + 8));
  const dx = look.x - b.vr.x, dz = look.z - b.vr.z;
  b.stepSoloPlayer(own, 0.05, Math.atan2(dx, -dz), Math.atan2(-1.65, Math.hypot(dx, dz)), new Set());
}
assert.equal(b.shelterState.inside, true, 'A lone headset must follow its own route and enter shelter without a laptop');
assert.equal(a.shelterState.inside, false);
const entrance = b.habitatEntrance(), exitYaw = Math.atan2(entrance.x - b.vr.x, -(entrance.z - b.vr.z));
b.stepSoloPlayer(own, 0.05, exitYaw, 0, new Set());
for (let i = 0; i < 100 && b.shelterState.inside; i++) b.stepSoloPlayer(own, 0.05, exitYaw, -Math.PI / 4, new Set());
assert.equal(b.shelterState.inside, false, 'The solo headset can also leave shelter without another device or keyboard');
assert.equal(b.joystickVector(0, 3, 40).fwd, 0, 'The stick dead zone prevents accidental movement');
const diagonal = b.joystickVector(80, -80, 40);
assert.ok(Math.abs(Math.hypot(diagonal.fwd, diagonal.strafe) - 1) < 1e-6, 'Diagonal stick speed is clamped');
const distances = [];
for (const strength of [0.5, 1]) {
  b.initVR(); const controller = b.createSoloController(), start = { x: b.vr.x, z: b.vr.z };
  Object.assign(b.mobileStick, { fwd: strength, strafe: 0 });
  for (let i = 0; i < 20; i++) b.stepSoloPlayer(controller, 0.05, Math.PI / 2, 0, new Set(), b.mobileStick);
  distances.push(Math.hypot(b.vr.x - start.x, b.vr.z - start.z));
  b.resetMobileStick(); const stopped = { x: b.vr.x, z: b.vr.z };
  for (let i = 0; i < 20; i++) b.stepSoloPlayer(controller, 0.05, 0, -0.9, new Set(), b.mobileStick);
  assert.deepEqual({ x: b.vr.x, z: b.vr.z }, stopped, 'Releasing the stick stops immediately, even when looking at the floor');
}
assert.ok(distances[1] > 2.9 && Math.abs(distances[1] - distances[0] * 2) < 0.02, 'Partial stick travel produces proportional walking speed');
console.log('PASS: VPS isolation, mobile analog joystick, dead zone, release/ground stop, solo climate, and unchanged local PC/headset relay');
