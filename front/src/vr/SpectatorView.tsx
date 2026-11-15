// spectator-host · the laptop.
//
//  • Full-screen view that follows the phone's head rotation (WebSocket).
//  • WASD / arrow keys move the astronaut, relative to where the head looks.
//  • Sends the position (+ the backpack drone) to the phone at 60 Hz and the
//    route polyline whenever it changes, so the player walks without nausea:
//    the phone only turns the head, the body moves smoothly from here.
//  • Runs the dynamic route (useDynamicRoute): leave the optimal polyline and
//    A* is re-run from your feet to the goal.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Effects } from '../components/canvas/Effects';
import { connect, ping, type SyncState, type WorldNet } from '../net/socket';
import { SharedWorld, useVRBoot } from './SharedWorld';
import { SuitModel, setSuitChoice, suitChoice } from './SuitModel';
import { useDynamicRoute } from './useDynamicRoute';
import { EYE_HEIGHT, cancelarDestino, setDestino, onWorldChange, currentGoal, deployDrone, moveAstronaut, recalculateRoute, setSolarTime, setWorldListener, stepDrone, updateBody, vr } from './vrEngine';
import { Governor, governorState } from '../render/Governor';
import { formatHours } from '../lib/marsTime';
import { suitState } from './suit/state';
import { DIM } from './suit/build';
import { rt } from '../store/simEngine';
import { useSimStore } from '../store/useSimStore';
import { heightAt } from '../lib/terrain';
import { siteName } from '../i18n';
import { Q, toneMap } from '../render/quality';
import { REAL } from '../lib/realTerrain';
import { SITES } from '../lib/sites';
import { VisorHud, bioSnapshot, stepBio } from '../hud';
import { buildMissionView, mission, missionActive } from '../mission/mission';
import { stepMission } from '../mission/driver';
import { MissionPanel, ModeLinks, useMissionSource } from '../mission/MissionPanel';
import { LayerControls } from '../lib/LayerControls';
import { layerState } from '../lib/layers';
import { JarvisOverlay } from '../jarvis/JarvisOverlay';
import { HallazgosPanel } from '../jarvis/HallazgosPanel';
import { jarvis } from '../jarvis/detector';
import { bindJarvisSync, toggleJarvis } from '../jarvis/sync';
import { NavMapDom, NavPanel } from '../nav/NavPanel';
import { navSnapshot, stepNav } from '../nav/nav';
import { escena, stepEscena } from '../sim/escenario';
import { EventosTab, NavStats, Section, Toggle } from './SpectatorMenu';
import { bd, guardarDestino, iniciarBd } from '../jarvis/bd';
import { RANGOS, mapa } from '../nav/drawNav';
import { nav } from '../nav/nav';

const keys = new Set<string>();
/** Look-down-to-walk: tilting the head below `thr` degrees walks forward at `speed` m/s. Set from the laptop. */
export const gaze = { on: true, speed: 3, thr: 25, walking: false, ramp: 0 };
const remote = { q: new THREE.Quaternion(), has: false, vrConnected: false, fresh: false, last: 0, tiltOnly: false };
const _yawQ = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
/** The headset gives the yaw, unless it is a phone without gyroscope (tilt only). */
const phoneYaw = () => remote.vrConnected && remote.has && !remote.tiltOnly;
const local = { yaw: Math.PI * 0.75, pitch: -0.12 };
const _fwd = new THREE.Vector3();

// Development hook: lets automated captures place the astronaut and aim the view.
/** Test autopilot (development only): walk along a fixed heading while the camera looks from elsewhere. */
const auto = { on: false, yaw: 0, speed: 1.2, camDist: 4.4 };
if (import.meta.env.DEV) (window as unknown as { __ares?: unknown }).__ares = { vr, rt, local, gaze, remote, keys, auto, suitState };

/** Yaw (clockwise from north) the player is looking at: the phone's, or the mouse's. */
function viewYaw() {
  if (phoneYaw()) {
    _fwd.set(0, 0, -1).applyQuaternion(remote.q);
    return Math.atan2(_fwd.x, -_fwd.z);
  }
  return local.yaw;
}

function HostLoop({ thirdPerson }: { thirdPerson: boolean }) {
  const camera = useThree((s) => s.camera);
  const socket = useMemo(() => connect('spectator-host'), []);
  const lastSend = useRef(0);
  const lastNav = useRef(0);
  const camQ = useMemo(() => new THREE.Quaternion(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const camPos = useMemo(() => new THREE.Vector3(), []);
  const follow = useRef({ ready: false });
  // Body velocity (smoothed), sent with the pose so the phone can extrapolate across network jitter.
  const vel = useRef({ x: 0, z: 0, px: NaN, pz: NaN });

  // 1) Input → body. Runs before the suit is animated (priority −2).
  useFrame((_, dtRaw) => {
    if (!vr.ready) return;
    const dt = Math.min(dtRaw, 0.05);
    // Keyboard → body motion, relative to the head's yaw.
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    if (!phoneYaw()) local.yaw += ((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * dt * 1.6;

    // Head orientation: the phone's quaternion when the headset is on.
    if (phoneYaw()) camQ.slerp(remote.q, 1 - Math.exp(-dt * 25));
    else if (remote.vrConnected && remote.has) camQ.slerp(_yawQ.setFromAxisAngle(_up, -local.yaw).multiply(remote.q), 1 - Math.exp(-dt * 25));
    else camQ.setFromEuler(new THREE.Euler(local.pitch, -local.yaw, 0, 'YXZ'));
    _fwd.set(0, 0, -1).applyQuaternion(camQ);
    const lookPitch = Math.asin(Math.max(-1, Math.min(1, _fwd.y)));
    const lookYaw = Math.abs(_fwd.y) < 0.995 ? Math.atan2(_fwd.x, -_fwd.z) : suitState.lookYaw;

    // Look down → walk forward (hands-free inside the Cardboard). Keys take priority.
    const pitchDeg = (lookPitch * 180) / Math.PI;
    const want = gaze.on && !fwd && !strafe && -pitchDeg > gaze.thr ? Math.min(1, (-pitchDeg - gaze.thr) / 8) : 0;
    gaze.ramp += (want - gaze.ramp) * (1 - Math.exp(-dt * 6)); // ease in/out, no jolts
    gaze.walking = gaze.ramp > 0.05;
    // Mission mode: the astronaut walks the telemetry track; keys and gaze only look around.
    if (missionActive()) {
      gaze.walking = false;
      stepMission(dt);
    } else if (auto.on) moveAstronaut(1, 0, auto.yaw, false, dt, auto.speed);
    else if (gaze.walking) moveAstronaut(1, 0, viewYaw(), false, dt, gaze.speed * gaze.ramp);
    else moveAstronaut(fwd, strafe, viewYaw(), keys.has('ShiftLeft') || keys.has('ShiftRight'), dt);

    // The head turns first; past ~55° the astronaut turns to follow it.
    suitState.lookYaw = auto.on ? auto.yaw : lookYaw; // (test autopilot: the head looks where it walks)
    suitState.lookPitch = auto.on ? 0 : lookPitch;
    updateBody(suitState.lookYaw, dt);
    stepDrone(dt);
    if (!missionActive()) {
      stepBio(dt); // mission: the suit numbers come from the messages
      stepEscena(dt);
    }
    stepNav(dt);
    const v = vel.current;
    if (Number.isFinite(v.px) && dt > 0) {
      const a = 1 - Math.exp(-dt * 12);
      v.x += ((vr.x - v.px) / dt - v.x) * a;
      v.z += ((vr.z - v.pz) / dt - v.z) * a;
    }
    v.px = vr.x;
    v.pz = vr.z;

    // 60 Hz position stream to the server (and on to the phone).
    const now = performance.now();
    if (now - lastSend.current > 15 && socket.connected) {
      lastSend.current = now;
      const sendNav = now - lastNav.current > 100;
      if (sendNav) lastNav.current = now;
      const d = rt.drone;
      socket.volatile.emit('position', {
        x: vr.x,
        y: heightAt(vr.x, vr.z),
        z: vr.z,
        heading: vr.heading,
        vx: v.x,
        vz: v.z,
        lookYaw: viewYaw(),
        ltst: rt.sun.ltst,
        storm: rt.stormIntensity,
        gaze: { on: gaze.on, speed: gaze.speed, thr: gaze.thr, walking: gaze.walking },
        drone: { x: d.x, y: d.y, z: d.z, heading: d.heading, state: d.state, rotor: d.rotor, scan: d.scanProgress },
        bio: bioSnapshot(),
        ...(sendNav ? { nav: navSnapshot() } : {}),
      });
    }
  }, -2);

  // 2) Camera, once the suit has been posed (its rig runs at priority −1).
  useFrame((_, dtRaw) => {
    if (!vr.ready) return;
    const dt = Math.min(dtRaw, 0.05);
    const ground = heightAt(vr.x, vr.z);
    _fwd.set(0, 0, -1).applyQuaternion(camQ);
    if (performance.now() < mission.farViewUntil) {
      // abortar: 3 s in the far view (CLAUDE.md §14), high above, looking at the astronaut.
      target.set(vr.x, ground, vr.z);
      camPos.set(vr.x + 70, ground + 110, vr.z + 70);
      camera.position.lerp(camPos, 1 - Math.exp(-dt * 4));
      camera.lookAt(target);
      follow.current.ready = false;
    } else if (!thirdPerson) {
      // Eyes: just above and ahead of the neck joint, so the camera rides the body's own motion.
      const yaw = suitState.lookYaw;
      const neckY = suitState.dockValid ? suitState.neck.y : ground + EYE_HEIGHT - DIM.EYE_UP;
      const nx = suitState.dockValid ? suitState.neck.x : vr.x;
      const nz = suitState.dockValid ? suitState.neck.z : vr.z;
      camera.position.set(nx + Math.sin(yaw) * DIM.EYE_FWD, neckY + DIM.EYE_UP, nz - Math.cos(yaw) * DIM.EYE_FWD);
      camera.quaternion.copy(camQ);
      follow.current.ready = false;
    } else {
      // Third person: a few metres behind the suit, looking where the head looks; the camera trails smoothly.
      target.set(vr.x, ground + 1.45, vr.z);
      camPos.set(vr.x - _fwd.x * auto.camDist, ground + 2.3 - _fwd.y * 3, vr.z - _fwd.z * auto.camDist);
      camPos.y = Math.max(camPos.y, heightAt(camPos.x, camPos.z) + 0.5);
      if (!follow.current.ready || camera.position.distanceTo(camPos) > 12) {
        camera.position.copy(camPos);
        follow.current.ready = true;
      } else camera.position.lerp(camPos, 1 - Math.exp(-dt * 9));
      camera.lookAt(target);
    }
  });
  return null;
}

function worldSnapshot(): WorldNet {
  const r = rt.route;
  const route: [number, number][] = [];
  for (let i = 0; i < r.n; i++) route.push([Math.round(r.xs[i] * 100) / 100, Math.round(r.zs[i] * 100) / 100]);
  const g = currentGoal();
  return {
    routeId: vr.routeId,
    route,
    canyonScanned: useSimStore.getState().canyonScanned,
    goal: g ? { code: g.code, x: g.x, z: g.z } : null,
    litres: vr.routeLitres,
    mission: missionActive() ? buildMissionView() : undefined,
    capa: layerState.actual,
    hazards: useSimStore.getState().hazards,
    bdRev: bd.rev,
    aviso: escena.aviso && escena.aviso.hasta > performance.now() ? { id: escena.aviso.id, texto: escena.aviso.texto, detalle: escena.aviso.detalle, nivel: escena.aviso.nivel } : null,
  };
}

export function SpectatorView() {
  const status = useVRBoot();
  const [thirdPerson, setThirdPerson] = useState(true);
  // Flag (experimental): the Blender astronaut of render/astronauta in third person.
  const [modelo, setModeloRaw] = useState(suitChoice.modelo);
  const setModelo = (m: 'procedural' | 'render') => {
    setSuitChoice(m);
    setModeloRaw(m);
  };
  // Menu: a tab (or none = folded). Remembered between visits.
  const [tab, setTabRaw] = useState<Tab | null>(() => {
    const t = localStorage.getItem('ares.tab');
    return t === 'none' ? null : TABS.some((x) => x.id === t) ? (t as Tab) : 'nav';
  });
  const lastTab = useRef<Tab>(tab ?? 'nav');
  const setTab = (t: Tab | null) => {
    if (t) lastTab.current = t;
    localStorage.setItem('ares.tab', t ?? 'none');
    setTabRaw(t);
  };
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const toggleMenu = () => setTab(tabRef.current ? null : lastTab.current);
  const [, force] = useState(0);
  const [gazeUi, setGazeUi] = useState({ on: gaze.on, speed: gaze.speed, thr: gaze.thr });
  const setGaze = (g: Partial<typeof gazeUi>) =>
    setGazeUi((cur) => {
      const n = { ...cur, ...g };
      n.speed = Math.max(0.5, Math.min(10, Math.round(n.speed * 2) / 2));
      n.thr = Math.max(10, Math.min(60, n.thr));
      Object.assign(gaze, n);
      return n;
    });
  // Scene controls: time of day, airborne dust, labels.
  const [envUi, setEnvUi] = useState({ ltst: 8, storm: 0, labels: true });
  useEffect(() => {
    if (status !== 'loading') setEnvUi((e) => ({ ...e, ltst: rt.sun.ltst }));
  }, [status]);
  const setLtst = (h: number) => {
    setSolarTime(h);
    setEnvUi((e) => ({ ...e, ltst: h }));
  };
  const setStorm = (v: number) => {
    rt.stormIntensity = v;
    setEnvUi((e) => ({ ...e, storm: v }));
  };
  const [hud, setHud] = useState({ storm: 0, connected: false, vr: false, tilt: false, walking: false, fps: 60, scale: 1, ping: NaN, msg: '', dev: 0, goal: '', dist: 0, litres: 0, recalcs: 0, drone: 'docked', head: 0, headAge: 0 });
  const scanned = useSimStore((s) => s.canyonScanned);
  // Free walk only: in mission mode the optimizer replans, not the view.
  useDynamicRoute(status !== 'loading' && !missionActive());
  useMissionSource(status !== 'loading');
  // Destination picked on the map (card in third person, the visor panel in first person).
  const [mapUi, setMapUi] = useState({ grande: false, rango: mapa.rango });
  const zoom = (dir: number) => {
    const i = Math.max(0, Math.min(RANGOS.length - 1, RANGOS.indexOf(mapa.rango) + dir));
    mapa.rango = RANGOS[i];
    setMapUi((m) => ({ ...m, rango: mapa.rango }));
  };
  const pick = (x: number, z: number) => {
    if (missionActive()) {
      vr.message = 'Modo misión: el destino lo decide el optimizador.';
      return;
    }
    setDestino(x, z);
    void guardarDestino(x, z);
  };
  // JARVIS catalogue in MySQL (XAMPP): the laptop seeds it and writes what the EVA finds.
  useEffect(() => {
    if (status !== 'loading') void iniciarBd(true, () => onWorldChange?.());
  }, [status]);

  // Socket: phone rotation in, world out.
  useEffect(() => {
    const socket = connect('spectator-host');
    bindJarvisSync(socket);
    socket.on('state', (s: SyncState) => {
      remote.vrConnected = s.vr;
      if (s.vr && s.rotation && !remote.fresh) {
        remote.q.set(s.rotation[0], s.rotation[1], s.rotation[2], s.rotation[3]);
        remote.tiltOnly = s.rotation[4] === 1;
        remote.has = true;
      }
    });
    // Head rotation relayed the instant the phone sends it (lower latency than the 60 Hz tick).
    socket.on('rotation', (q: number[]) => {
      remote.q.set(q[0], q[1], q[2], q[3]);
      remote.tiltOnly = q[4] === 1;
      remote.has = true;
      remote.vrConnected = true;
      remote.fresh = true;
      remote.last = performance.now();
    });
    const push = () => socket.connected && socket.emit('world', worldSnapshot());
    setWorldListener(push);
    socket.on('connect', () => setTimeout(push, 200));
    socket.on('presence', () => setTimeout(push, 100));
    const id = window.setInterval(async () => {
      const g = currentGoal();
      setHud({
        storm: rt.stormIntensity,
        connected: socket.connected,
        vr: remote.vrConnected,
        tilt: remote.tiltOnly,
        walking: gaze.walking,
        fps: governorState.fps,
        scale: governorState.dpr,
        ping: await ping(),
        msg: vr.message,
        dev: vr.lastDeviation,
        goal: g ? (g.code === 'A' ? 'Hábitat (A)' : `${g.code} · ${siteName(g.code)}`) : '—',
        dist: g ? Math.hypot(g.x - vr.x, g.z - vr.z) : 0,
        litres: vr.routeLitres,
        recalcs: vr.recalcs,
        drone: rt.drone.state,
        head: ((viewYaw() * 180) / Math.PI + 360) % 360,
        headAge: remote.last ? performance.now() - remote.last : Infinity,
      });
    }, 100);
    return () => {
      setWorldListener(null);
      window.clearInterval(id);
    };
  }, []);

  // Keyboard + mouse look (when no headset is connected).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.add(e.code);
      if (e.code === 'KeyV') setThirdPerson((t) => !t);
      if (e.code === 'KeyJ') (toggleJarvis(), force((k) => k + 1));
      if (e.code === 'KeyM') toggleMenu();
      if (e.code === 'KeyF' || e.code === 'Space') deployDrone();
      if (e.code === 'KeyR' && !missionActive()) recalculateRoute('recalculada a pedido');
      if (e.code === 'KeyG') setGaze({ on: !gaze.on });
      if (e.code === 'KeyL') setEnvUi((v) => ({ ...v, labels: !v.labels }));
      if (e.code === 'BracketRight' || e.code === 'NumpadAdd' || e.code === 'Equal') setGaze({ speed: gaze.speed + 0.5 });
      if (e.code === 'BracketLeft' || e.code === 'NumpadSubtract' || e.code === 'Minus') setGaze({ speed: gaze.speed - 0.5 });
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const blur = () => keys.clear();
    let drag = false;
    let lx = 0;
    let ly = 0;
    const pd = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, [data-ui]')) return;
      drag = true;
      lx = e.clientX;
      ly = e.clientY;
    };
    const pm = (e: PointerEvent) => {
      if (!drag || phoneYaw()) return;
      local.yaw += (e.clientX - lx) * 0.004;
      local.pitch = Math.max(-1.2, Math.min(1.2, local.pitch - (e.clientY - ly) * 0.004));
      lx = e.clientX;
      ly = e.clientY;
    };
    const pu = () => (drag = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
    };
  }, []);

  const btn = 'px-2.5 py-1.5 rounded-lg border text-[12.5px] transition hover:bg-white/5';
  const tabs = TABS.filter((t) => !t.real || REAL);
  return (
    <div className={`fixed inset-0 bg-black select-none ${envUi.labels ? '' : 'no-labels'}`}>
      <Canvas
        shadows="percentage"
        dpr={[1, Q.dprMax]}
        gl={{ antialias: Q.post === 'none' && Q.antialias, powerPreference: 'high-performance', stencil: false, toneMapping: { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping }[toneMap], toneMappingExposure: 4 }}
        camera={{ fov: 62, near: 0.08, far: 160000 }}
      >
        <SharedWorld />
        <SuitModel firstPerson={!thirdPerson} modelo={modelo} />
        <HostLoop thirdPerson={thirdPerson} />
        {/* Suit holograms: on the visor in first person, beside the astronaut in third person. */}
        <VisorHud anchor={thirdPerson ? 'body' : 'visor'} fxStrength={thirdPerson ? 0.6 : 1} />
        {/* JARVIS: detection frames on the objects; heading tape and the mini map on the visor in first person. */}
        <JarvisOverlay anchor={thirdPerson ? 'world' : 'visor'} />
        {!thirdPerson && <NavPanel onPick={pick} />}
        <Governor />
        <Effects />
      </Canvas>

      {/* Top bar: always there, small. */}
      <div className="absolute top-3 left-3 right-3 flex items-start gap-2 pointer-events-none">
        <div className="glass pointer-events-auto flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-slate-200">
          <button onClick={toggleMenu} title="Mostrar u ocultar el menú (M)" className={`${btn} ${tab ? 'border-cyan-300/70 text-cyan-100' : 'border-slate-600'}`}>
            ☰ Menú
          </button>
          <span className="font-display tracking-[0.22em] text-cyan-200 text-sm hidden md:inline">ARES-TWIN</span>
          <span className="flex items-center gap-2 font-mono text-[11.5px]" title="Servidor de sincronización y casco (celular)">
            <span className={hud.connected ? 'text-emerald-300' : 'text-red-300'}>● servidor</span>
            <span className={hud.vr ? 'text-emerald-300' : 'text-slate-500'}>● casco</span>
            <span className="text-slate-500">{Number.isFinite(hud.ping) ? `${hud.ping.toFixed(0)} ms` : ''}</span>
          </span>
          <button onClick={() => (toggleJarvis(), force((k) => k + 1))} title="Vista JARVIS o normal en el visor (J)" className={`${btn} ${jarvis.on ? 'border-fuchsia-400/80 text-fuchsia-200 bg-fuchsia-500/10' : 'border-slate-600 text-slate-400'}`}>
            {jarvis.on ? '◆ JARVIS' : '○ Normal'}
          </button>
          <button onClick={() => setThirdPerson((t) => !t)} title="Primera o tercera persona (V)" className={`${btn} border-slate-600`}>
            {thirdPerson ? '👁 3ª persona' : '👁 1ª persona'}
          </button>
        </div>
        {hud.msg && <div className="glass hidden lg:block pointer-events-none px-3 py-2 text-[12px] text-emerald-200/90 leading-snug max-w-[440px]">{hud.msg}</div>}
      </div>

      {/* Side menu: icon tabs + the open tab. Folds away with M or ☰. */}
      {tab && (
        <div className="absolute top-[64px] left-3 bottom-3 flex gap-2 pointer-events-none">
          <nav className="glass pointer-events-auto flex flex-col gap-1 p-1.5 self-start">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                title={t.label}
                className={`relative w-[58px] rounded-lg py-1.5 flex flex-col items-center gap-0.5 transition ${tab === t.id ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
              >
                <span className="text-lg leading-none">{t.icon}</span>
                <span className="text-[10px] leading-none">{t.short}</span>
                {t.id === 'hallazgos' && jarvis.hallazgos.length > 0 && <span className="absolute top-0.5 right-1 min-w-[16px] h-4 px-1 rounded-full bg-fuchsia-500 text-[10px] text-white leading-4">{jarvis.hallazgos.length}</span>}
              </button>
            ))}
            <button onClick={() => setTab(null)} title="Ocultar el menú (M)" className="w-[58px] rounded-lg py-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200 text-[11px]">
              ◀
            </button>
          </nav>
          <div className="glass pointer-events-auto w-[min(390px,calc(100vw-110px))] overflow-y-auto p-3.5 text-[12.5px] text-slate-200 space-y-4">
            <h2 className="text-[15px] font-semibold text-cyan-100">{TABS.find((t) => t.id === tab)?.label}</h2>

            {tab === 'nav' && (
              <>
                <NavStats />
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => deployDrone()} disabled={hud.drone !== 'docked'} className={`${btn} border-cyan-400/60 text-cyan-100 disabled:opacity-40`}>
                    {hud.drone === 'docked' ? (REAL ? '🛸 Dron al objetivo (F)' : scanned ? '🛸 Re-escanear (F)' : '🛸 Escanear cañón (F)') : `🛸 ${hud.drone}`}
                  </button>
                  {!missionActive() && (
                    <>
                      <button onClick={() => recalculateRoute('recalculada a pedido')} className={`${btn} border-slate-600`}>
                        ↻ Recalcular ruta (R)
                      </button>
                      {nav.code === 'D' && (
                        <button onClick={() => cancelarDestino()} className={`${btn} border-amber-400/60 text-amber-200`}>
                          ⌂ Volver a la base
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="text-[12px] text-slate-400 space-y-1">
                  <div>
                    Rumbo del casco <b className="text-cyan-200 font-mono">{hud.head.toFixed(0)}°</b>{' '}
                    {hud.vr ? hud.headAge < 500 ? <span className="text-emerald-300">· en vivo</span> : <span className="text-amber-300">· sin datos del celular</span> : <span>· mouse / Q-E</span>}
                  </div>
                  {!missionActive() && (
                    <div>
                      Ruta {hud.litres.toFixed(1)} L de O₂ · {hud.recalcs} cálculos A* (recalcula al desviarte más de 3,5 m)
                    </div>
                  )}
                  {REAL && SITES.length > 0 && (
                    <div>
                      Terreno real 480 m · {SITES.length} sitios CRISM desde {SITES[0].source === 'backend' ? 'el backend' : 'terreno/sitios.json'}
                    </div>
                  )}
                  <div className="text-emerald-200/90 lg:hidden">{hud.msg}</div>
                </div>
              </>
            )}

            {tab === 'sim' && <EventosTab />}

            {tab === 'mision' && (
              <>
                <ModeLinks />
                {missionActive() ? <MissionPanel /> : <div className="text-[12px] text-slate-400 leading-snug">Modo libre: caminás vos y A* replanifica. Elegí <b>Misión</b> para reproducir el registro del guion, o <b>Vivo</b> para conectarte al backend.</div>}
              </>
            )}

            {tab === 'control' && (
              <>
                <Section title="Caminar sin manos (Cardboard)">
                  <Toggle on={gazeUi.on} onClick={() => setGaze({ on: !gazeUi.on })} label="Mirar abajo para avanzar" hint={hud.walking ? '▼ avanzando' : 'quieto'} />
                  <label className="flex items-center gap-2">
                    <span className="w-28 text-slate-400">Velocidad</span>
                    <input type="range" min={0.5} max={10} step={0.5} value={gazeUi.speed} onChange={(e) => setGaze({ speed: +e.target.value })} className="flex-1 accent-cyan-400" />
                    <span className="w-16 text-right font-mono text-cyan-200">{gazeUi.speed.toFixed(1)} m/s</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-28 text-slate-400">Mirar abajo de</span>
                    <input type="range" min={10} max={60} step={1} value={gazeUi.thr} onChange={(e) => setGaze({ thr: +e.target.value })} className="flex-1 accent-cyan-400" />
                    <span className="w-16 text-right font-mono text-cyan-200">{gazeUi.thr}°</span>
                  </label>
                  <div className="text-[11px] text-slate-500">Una persona camina a ~1,4 m/s; el plan usa el ritmo del contrato (~0,9 m/s en plano).</div>
                </Section>
                <Section title="Teclado">
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                    {KEYS.map(([k, d]) => (
                      <Fragment key={k}>
                        <kbd className="font-mono text-cyan-200 bg-slate-800/70 border border-slate-600 rounded px-1.5 text-center">{k}</kbd>
                        <span className="text-slate-300">{d}</span>
                      </Fragment>
                    ))}
                  </div>
                  {!hud.vr && <div className="text-[11px] text-slate-500">Sin casco: arrastrá el mouse o usá Q / E para girar.</div>}
                  {hud.vr && hud.tilt && <div className="text-[11px] text-amber-300">El celular no tiene giroscopio: girá con Q / E o el mouse.</div>}
                </Section>
              </>
            )}

            {tab === 'entorno' && (
              <>
                <Section title="TIFF y modelos de elevación">
                  <a href="/rasters.html" target="_blank" rel="noopener noreferrer" className={`${btn} inline-block border-cyan-400/60 text-cyan-100`}>Ver TIFF y DEM · 2D / 3D ↗</a>
                </Section>
                <Section title="Escena">
                  <label className="flex items-center gap-2">
                    <span className="w-28 text-slate-400">Hora solar</span>
                    <input type="range" min={5.6} max={18.9} step={0.05} value={envUi.ltst} onChange={(e) => setLtst(+e.target.value)} className="flex-1 accent-amber-400" />
                    <span className="w-14 text-right font-mono text-amber-200">{formatHours(envUi.ltst)}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-28 text-slate-400">Polvo en el aire</span>
                    <input type="range" min={0} max={1} step={0.02} value={hud.storm} onChange={(e) => setStorm(+e.target.value)} className="flex-1 accent-amber-400" />
                    <span className="w-14 text-right font-mono text-amber-200">τ {(0.6 + 3.4 * hud.storm).toFixed(1)}</span>
                  </label>
                  <Toggle on={envUi.labels} onClick={() => setEnvUi((v) => ({ ...v, labels: !v.labels }))} label="Etiquetas en el terreno (L)" />
                  <Toggle on={modelo === 'render'} onClick={() => setModelo(modelo === 'render' ? 'procedural' : 'render')} label="Astronauta de render/ (experimental)" hint="3ª persona" />
                  <div className="font-mono text-[11px] text-slate-500">
                    {hud.fps.toFixed(0)} fps · resolución {(hud.scale * 100).toFixed(0)} %
                  </div>
                </Section>
                {REAL && (
                  <Section title="Capas del paquete de terreno">
                    <LayerControls />
                  </Section>
                )}
              </>
            )}

            {tab === 'hallazgos' && <HallazgosPanel />}
          </div>
        </div>
      )}

      {/* Laptop: the suit's navigation map as a corner card (third person; in first person it is on the visor, also clickable). */}
      {status !== 'loading' && (
        <div data-ui className={`absolute bottom-3 right-3 ${mapUi.grande ? 'w-[min(420px,40vw)]' : 'w-[clamp(190px,17vw,260px)]'} glass p-1.5 space-y-1`}>
          <div className="flex items-center gap-1 text-[11.5px] text-slate-300">
            <button onClick={() => zoom(-1)} title="Acercar" className="w-6 h-6 rounded border border-slate-600 hover:bg-white/10">＋</button>
            <button onClick={() => zoom(1)} title="Alejar" className="w-6 h-6 rounded border border-slate-600 hover:bg-white/10">－</button>
            <span className="font-mono text-slate-400 px-1">{mapUi.rango} m</span>
            <span className="flex-1" />
            {nav.code === 'D' && (
              <button onClick={() => cancelarDestino()} title="Quitar el destino marcado" className="px-1.5 h-6 rounded border border-amber-400/60 text-amber-200 hover:bg-amber-400/10">✕ destino</button>
            )}
            <button onClick={() => setMapUi((m) => ({ ...m, grande: !m.grande }))} title="Agrandar o achicar" className="w-6 h-6 rounded border border-slate-600 hover:bg-white/10">
              {mapUi.grande ? '⤡' : '⤢'}
            </button>
          </div>
          {thirdPerson || mapUi.grande ? (
            <NavMapDom className="w-full h-auto" onPick={pick} />
          ) : (
            <div className="text-[11px] text-slate-400 px-1 pb-0.5">El mapa está en el visor: hacé clic en él para marcar un destino.</div>
          )}
          <div className="text-[10.5px] text-slate-500 px-1">{missionActive() ? 'Modo misión: destino del optimizador' : 'Clic en el mapa: ir a ese punto (A*)'}</div>
        </div>
      )}
      {status === 'loading' && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 glass px-3 py-1.5 text-[12px] text-cyan-200">{REAL ? 'Cargando el terreno real (DEM, HiRISE, sitios CRISM)…' : 'Cargando Marte desde NASA Mars Trek…'}</div>}
    </div>
  );
}

type Tab = 'nav' | 'sim' | 'mision' | 'control' | 'entorno' | 'hallazgos';
const TABS: { id: Tab; icon: string; short: string; label: string; real?: boolean }[] = [
  { id: 'nav', icon: '🧭', short: 'Ruta', label: 'Navegación' },
  { id: 'sim', icon: '⚡', short: 'Simular', label: 'Simular eventos' },
  { id: 'mision', icon: '🚀', short: 'Misión', label: 'Misión y fuentes de datos', real: true },
  { id: 'control', icon: '🎮', short: 'Control', label: 'Control del astronauta' },
  { id: 'entorno', icon: '☀️', short: 'Entorno', label: 'Entorno y capas' },
  { id: 'hallazgos', icon: '★', short: 'Hallazgos', label: 'Hallazgos JARVIS' },
];

const KEYS: [string, string][] = [
  ['W A S D', 'caminar hacia donde mira el casco'],
  ['Shift', 'más rápido'],
  ['Q / E', 'girar (sin casco)'],
  ['V', '1ª / 3ª persona'],
  ['J', 'vista JARVIS / normal'],
  ['M', 'mostrar u ocultar el menú'],
  ['F', 'lanzar el dron'],
  ['R', 'recalcular la ruta'],
  ['clic en el mapa', 'marcar destino (sin destino: vuelve a la base)'],
  ['G', 'mirar abajo para avanzar'],
  ['[ / ]', 'bajar / subir la velocidad'],
  ['L', 'etiquetas'],
];
