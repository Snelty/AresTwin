// Where the mission messages come from.
//
//   Recorded mission (?modo=mision): logs/<registro>.jsonl + .marcadores.json,
//     played at ×30 by default (CLAUDE.md §5), with play / pause / speed and
//     jumps (§5.6: empty state, re-apply every message with t ≤ target, no
//     animation; a marker starts 30 s early to see it happen).
//   Live (?modo=vivo): the backend's WebSocket, /ws?rol=vr (proxied by Vite to
//     ARES_BACKEND). It sends a snapshot on connect, then the telemetry's
//     events and the Motor's messages as they happen. Positions are shown one
//     telemetry interval (10 s simulated) behind, so they can be interpolated.
import { apply, mission, resetMission, type Msg } from './mission';

/** Fallback when the server cannot say which is the newest mission log. */
export const DEFAULT_LOG = 'sesion-2026-11-13-mision';

/** The astronaut-state message (estado_astronauta; telemetria_astronauta before 2026-11-13). */
export const esEstado = (tipo: unknown) => tipo === 'estado_astronauta' || tipo === 'telemetria_astronauta';

/** Newest logs/sesion-<fecha>-mision.jsonl (served as /logs/ultimo.json by Vite and server.js). */
export async function ultimoRegistro(): Promise<string> {
  try {
    const r = await fetch('/logs/ultimo.json');
    const j = (await r.json()) as { nombre?: string };
    if (j.nombre) return j.nombre;
  } catch {
    /* fallback below */
  }
  return DEFAULT_LOG;
}

export interface Marcador {
  id: string;
  t: number;
  min: number;
  clase: string;
  titulo: string;
  detalle: string;
  nivel: number;
  sitio_id?: number;
}

export const player = {
  msgs: [] as Msg[],
  marcadores: [] as Marcador[],
  idx: 0,
  /** Display clock, simulated seconds. */
  clock: 0,
  duration: 0,
  playing: true,
  factor: 30,
  nombre: '',
};

// ---------------------------------------------------------------------------
// Recorded mission
// ---------------------------------------------------------------------------
export async function loadReplay(nombre?: string) {
  nombre ??= await ultimoRegistro();
  mission.modo = 'mision';
  mission.estadoFuente = `Cargando logs/${nombre}.jsonl…`;
  const res = await fetch(`/logs/${nombre}.jsonl`);
  if (!res.ok) throw new Error(`logs/${nombre}.jsonl: ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) throw new Error(`logs/${nombre}.jsonl no existe`);
  player.msgs = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Msg);
  player.duration = player.msgs.reduce((m, x) => Math.max(m, typeof x.t === 'number' ? x.t : 0), 0);
  player.nombre = nombre;
  try {
    const mk = await (await fetch(`/logs/${nombre}.marcadores.json`)).json();
    player.marcadores = (mk.marcadores ?? []) as Marcador[];
  } catch {
    player.marcadores = [];
  }
  mission.estadoFuente = `Registro ${nombre}.jsonl · ${player.msgs.length} mensajes · ${(player.duration / 60).toFixed(0)} min simulados`;
  jump(0);
}

/** Preload the whole telemetry track: the recording knows where the astronaut will be. */
function preloadTrack() {
  mission.track = [];
  for (const m of player.msgs)
    if (esEstado(m.tipo)) {
      const d = m.datos as { x: number; y: number };
      mission.track.push({ t: m.t ?? 0, x: d.x, y: d.y });
    }
}

/** Empty the state and re-apply everything up to t, without animating. */
export function jump(t: number) {
  resetMission();
  preloadTrack();
  const target = Math.max(0, Math.min(player.duration, t));
  let i = 0;
  for (; i < player.msgs.length && (player.msgs[i].t ?? 0) <= target; i++) apply(player.msgs[i], false);
  player.idx = i;
  player.clock = target;
  mission.t = target;
  mission.version++;
}

export const jumpToMarker = (m: Marcador) => jump(m.t - 30);

export function stepReplay(dtReal: number) {
  if (!player.msgs.length) return;
  if (player.playing) player.clock = Math.min(player.duration, player.clock + dtReal * player.factor);
  while (player.idx < player.msgs.length && (player.msgs[player.idx].t ?? 0) <= player.clock) apply(player.msgs[player.idx++], true);
  mission.t = player.clock;
  if (player.clock >= player.duration) player.playing = false;
}

// ---------------------------------------------------------------------------
// Live (backend WebSocket)
// ---------------------------------------------------------------------------
export const live = {
  ws: null as WebSocket | null,
  connected: false,
  lastTelT: 0,
  lastTelAt: 0,
  factor: 30,
  mensajes: 0,
  error: '',
};

const TEL_LAG = 10; // s simulated: one telemetry interval

export function connectLive() {
  mission.modo = 'vivo';
  resetMission();
  const token = (import.meta.env?.VITE_ARES_TOKEN as string | undefined) ?? '';
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?rol=vr${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  const open = () => {
    mission.estadoFuente = 'Conectando al backend…';
    const ws = new WebSocket(url);
    live.ws = ws;
    ws.onopen = () => {
      live.connected = true;
      live.error = '';
      mission.estadoFuente = 'Backend en vivo · esperando telemetría';
    };
    ws.onmessage = (ev) => {
      let m: Msg;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      live.mensajes++;
      if (m.tipo === 'perfil' && !dana.corriendo) live.factor = typeof m.factor_tiempo === 'number' ? m.factor_tiempo : 30;
      if (m.tipo === 'error') live.error = String(m.detalle ?? m.codigo ?? 'error');
      if (esEstado(m.tipo) && typeof m.t === 'number') {
        live.lastTelT = m.t;
        live.lastTelAt = performance.now();
        mission.estadoFuente = `Backend en vivo · t = ${(m.t / 60).toFixed(1)} min · ${live.mensajes} mensajes`;
      }
      apply(m, true);
    };
    ws.onclose = (ev) => {
      live.connected = false;
      live.error = ev.reason || live.error || 'sin conexión';
      mission.estadoFuente = `Backend desconectado (${live.error}) · reintentando…`;
      setTimeout(open, 2000);
    };
  };
  open();
}

/** Live display clock: one telemetry interval behind the newest message, advancing at the profile's pace. */
export function liveClock() {
  if (!live.lastTelAt) return 0;
  const ahead = ((performance.now() - live.lastTelAt) / 1000) * live.factor;
  return Math.min(live.lastTelT, live.lastTelT - TEL_LAG + ahead);
}

// ---------------------------------------------------------------------------
// Live: the laptop can play the data simulation (Dana) into the backend
// ---------------------------------------------------------------------------
// The mission's INPUT events (estado_astronauta, peligro, ventanas, SPE, hito) from
// the newest log, sent over /ws?rol=dana at the mission's pace, after the
// scenario profile. The planes, estado_aborto and abortar are NOT sent: the
// backend's Motor computes them live (same as herramientas/reproducir_en_backend.py).
const ENTRADAS = new Set(['estado_astronauta', 'telemetria_astronauta', 'peligro', 'ventanas', 'SPE', 'hito']);

export const dana = {
  corriendo: false,
  enviados: 0,
  total: 0,
  t: 0,
  factor: 30,
  estado: '',
  ws: null as WebSocket | null,
};

export async function simularEnBackend(factor = 30) {
  detenerSimulacion();
  dana.factor = factor;
  dana.estado = 'Preparando…';
  const token = (import.meta.env?.VITE_ARES_WRITE_TOKEN as string | undefined) ?? '';
  try {
    const perfil = (await (await fetch('/api/v1/demo/perfil')).json()) as Msg;
    const nombre = await ultimoRegistro();
    const text = await (await fetch(`/logs/${nombre}.jsonl`)).text();
    const eventos = text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Msg)
      .filter((m) => ENTRADAS.has(String(m.tipo)));
    dana.total = eventos.length;
    dana.enviados = 0;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?rol=dana${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    const ws = new WebSocket(url);
    dana.ws = ws;
    dana.corriendo = true;
    let perfilOk = false;
    ws.onmessage = (ev) => {
      const r = JSON.parse(String(ev.data)) as Msg;
      if (r.tipo === 'perfil_cargado') perfilOk = true;
      if (r.tipo === 'error') dana.estado = `Error del backend: ${String(r.codigo ?? '')} ${String(r.detalle ?? '')}`;
    };
    ws.onclose = (ev) => {
      if (dana.corriendo) dana.estado = `Conexión cerrada${ev.reason ? `: ${ev.reason}` : ''}`;
      dana.corriendo = false;
    };
    await new Promise<void>((ok, fail) => {
      ws.onopen = () => ok();
      ws.onerror = () => fail(new Error('no se pudo abrir /ws?rol=dana (¿backend apagado o ya hay otro productor?)'));
    });
    ws.send(JSON.stringify(perfil));
    for (let i = 0; i < 50 && !perfilOk && dana.corriendo; i++) await new Promise((r) => setTimeout(r, 100));
    if (!perfilOk) throw new Error(dana.estado || 'el backend no aceptó el perfil');
    live.factor = factor; // the display clock runs at the pace the events are sent
    dana.estado = `Simulando ${nombre} ×${factor}`;
    const t0 = eventos[0]?.t ?? 0;
    const inicio = performance.now();
    let seq = 0;
    for (const e of eventos) {
      if (!dana.corriendo) return;
      const ev: Msg = e.tipo === 'hito' ? e : { ...e, seq: ++seq }; // the hito does not consume seq
      const espera = ((ev.t ?? 0) - t0) / factor - (performance.now() - inicio) / 1000;
      if (espera > 0) await new Promise((r) => setTimeout(r, espera * 1000));
      if (!dana.corriendo || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(ev));
      dana.enviados++;
      dana.t = ev.t ?? 0;
    }
    dana.estado = `Misión completa (${dana.enviados} eventos)`;
    dana.corriendo = false;
    ws.close();
  } catch (e) {
    dana.estado = e instanceof Error ? e.message : String(e);
    detenerSimulacion();
  }
}

export function detenerSimulacion() {
  const was = dana.corriendo;
  dana.corriendo = false;
  dana.ws?.close();
  dana.ws = null;
  if (was) dana.estado = `Detenida en el minuto ${(dana.t / 60).toFixed(1)}`;
}

/** Backend reachable? (/health through the Vite proxy) */
export async function saludBackend(): Promise<{ ok: boolean; motor?: string; detalle?: string }> {
  try {
    const r = await fetch('/health', { cache: 'no-store' });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !type.includes('json')) return { ok: false, detalle: `respuesta ${r.status}` };
    const j = (await r.json()) as { estado?: string; motor?: string };
    return { ok: j.estado === 'ok', motor: j.motor };
  } catch (e) {
    return { ok: false, detalle: e instanceof Error ? e.message : String(e) };
  }
}

// Development hook for automated checks (same module instances as the app).
if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __aresMission?: unknown }).__aresMission = { mission, player, live, dana, jump, jumpToMarker };
