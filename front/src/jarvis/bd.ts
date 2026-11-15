// JARVIS ↔ MySQL (XAMPP) through front/bd/api.php (proxied by Vite as /bd/api.php).
//
//   • the orbital survey (simulated) is seeded into `objetos` the first time;
//   • the catalogue the suit compares against is read back from the database;
//   • objects the EVA finds that are not in it are REGISTERED (fuente = 'eva'):
//     on the next pass they come up as catalogued;
//   • every identification goes to `observaciones` (one row per object and
//     session, kept at its most confident).
//
// Only the laptop writes (the position authority); the phone reads the same
// catalogue and refetches when the laptop says it changed (world.bdRev).
// Without the database everything keeps working on the in-memory catalogue.
import { REAL, enuToScene, sceneToEnu } from '../lib/realTerrain';
import { ensureField, field, type Clase, type DbEntry, type FieldObject } from './catalog';
import type { LitoId } from './lithology';

const URL = '/bd/api.php';
export const ESCENARIO = REAL ? 'real-480' : 'procedural';

export const bd = {
  estado: 'sin conectar' as 'sin conectar' | 'conectando' | 'conectado' | 'sin bd',
  msg: '',
  orbital: 0,
  eva: 0,
  obs: 0,
  rev: '',
  autoridad: false,
  sesion: `eva-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 6)}`,
  registrados: 0,
  version: 0,
};

async function call<T = Record<string, unknown>>(accion: string, body?: unknown): Promise<T> {
  const ctl = new AbortController();
  const id = window.setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(`${URL}?accion=${accion}&escenario=${ESCENARIO}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify({ escenario: ESCENARIO, ...(body as object) }) : undefined,
      signal: ctl.signal,
    });
    const type = r.headers.get('content-type') ?? '';
    if (!type.includes('json')) throw new Error(`la API no respondió JSON (${r.status}): ¿Apache de XAMPP encendido?`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error ?? `error ${r.status}`);
    return j as T;
  } finally {
    window.clearTimeout(id);
  }
}

interface Fila {
  id: string;
  clase: Clase;
  litologia: LitoId | null;
  x: number;
  y: number;
  radio_m: number;
  forma: number;
  fuente: 'orbital' | 'eva';
  confianza: number;
  interes: number;
  nota: string | null;
}

const toFila = (e: DbEntry): Omit<Fila, 'fuente'> => {
  const p = sceneToEnu(e.x, e.z);
  return { id: e.id, clase: e.clase, litologia: e.lito ?? null, x: +p.x.toFixed(2), y: +p.y.toFixed(2), radio_m: +e.r.toFixed(3), forma: +e.forma.toFixed(3), confianza: e.conf ?? 1, interes: e.interes ?? 0, nota: e.nota ?? null };
};

async function estado() {
  const j = await call<{ objetos: { orbital: number; eva: number }; observaciones: number; rev: string }>('estado');
  bd.orbital = j.objetos.orbital;
  bd.eva = j.objetos.eva;
  bd.obs = j.observaciones;
  return j.rev;
}

/** Read the catalogue the suit compares against. */
export async function cargarCatalogo() {
  const j = await call<{ rev: string; objetos: Fila[] }>('catalogo');
  field.db = j.objetos.map((f) => {
    const s = enuToScene(f.x, f.y);
    return { id: f.id, clase: f.clase, x: s.x, z: s.z, r: f.radio_m, forma: f.forma, fuente: f.fuente, lito: f.litologia ?? undefined, conf: f.confianza, interes: f.interes, nota: f.nota ?? undefined };
  });
  field.nDb = field.db.length;
  field.dbFrom = 'bd';
  bd.rev = j.rev;
  bd.version++;
}

let onChange: (() => void) | null = null;
let poll = 0;
let flushT = 0;

/** Laptop (autoridad = true) or phone. Safe to call again (re-seeds after a terrain change). */
export async function iniciarBd(autoridad: boolean, cambio?: () => void) {
  bd.autoridad = autoridad;
  onChange = cambio ?? null;
  bd.estado = 'conectando';
  bd.msg = '';
  try {
    ensureField();
    await estado();
    if (autoridad && bd.orbital === 0) {
      const orbital = field.dbLocal.map(toFila);
      await call('sembrar', { objetos: orbital });
      await estado();
    }
    await cargarCatalogo();
    bd.estado = 'conectado';
    bd.msg = `MySQL ares_twin · ${ESCENARIO}`;
  } catch (e) {
    bd.estado = 'sin bd';
    bd.msg = `${(e as Error).message} · se usa el catálogo en memoria`;
    field.db = field.dbLocal.slice();
    field.dbFrom = 'local';
    field.nDb = field.db.length;
  }
  bd.version++;
  window.clearInterval(poll);
  window.clearInterval(flushT);
  if (autoridad) {
    poll = window.setInterval(refrescar, 5000);
    flushT = window.setInterval(() => void flush(), 2000);
  }
}

/** Counts, and a catalogue reload if it changed. */
export async function refrescar() {
  try {
    const rev = await estado();
    if (bd.estado !== 'conectado') bd.estado = 'conectado';
    if (rev !== bd.rev) {
      await cargarCatalogo();
      onChange?.();
    }
  } catch (e) {
    bd.estado = 'sin bd';
    bd.msg = (e as Error).message;
  }
  bd.version++;
}

/** Phone: the laptop says the catalogue changed. */
export function revRemota(rev: string | undefined) {
  if (rev && rev !== bd.rev && bd.estado !== 'sin bd') void cargarCatalogo().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Writes (laptop only), batched
// ---------------------------------------------------------------------------
const pendientesReg = new Map<string, Omit<Fila, 'fuente'>>();
const registrados = new Set<string>();
const pendientesObs = new Map<string, Record<string, unknown>>();
const mejorConf = new Map<string, number>();

/** A NEW object the suit mapped: it goes into the catalogue (fuente = 'eva'). */
export function registrar(o: FieldObject, rMedido: number, lito: LitoId | null, conf: number, interes: number, nota: string) {
  if (!bd.autoridad || registrados.has(o.id)) return;
  registrados.add(o.id);
  // The suit's own position fix: a few centimetres of error.
  const e: DbEntry = { id: o.id, clase: o.clase, x: o.x, z: o.z, r: rMedido, forma: o.forma, fuente: 'eva', lito: lito ?? undefined, conf, interes, nota };
  pendientesReg.set(o.id, toFila(e));
  if (bd.estado !== 'conectado') {
    // No database: keep it in memory so it is "known" from now on.
    field.db.push(e);
    field.nDb = field.db.length;
    bd.registrados++;
  }
}

export const yaRegistrado = (id: string) => registrados.has(id);

/** An identification; kept only when more confident than the last one sent. */
export function observar(item: { objeto_id: string; conf: number } & Record<string, unknown>) {
  if (!bd.autoridad || bd.estado !== 'conectado') return;
  const prev = mejorConf.get(item.objeto_id) ?? -1;
  if (item.conf < prev + 0.05) return;
  mejorConf.set(item.objeto_id, item.conf);
  const { conf, ...rest } = item;
  pendientesObs.set(item.objeto_id, { ...rest, confianza: +conf.toFixed(3) });
}

async function flush() {
  if (bd.estado !== 'conectado') return;
  try {
    if (pendientesReg.size) {
      const objetos = [...pendientesReg.values()];
      pendientesReg.clear();
      const j = await call<{ insertados: number }>('registrar', { objetos });
      bd.registrados += j.insertados;
      await refrescar(); // the new entries become part of the catalogue (and the phone is told)
    }
    if (pendientesObs.size) {
      const items = [...pendientesObs.values()];
      pendientesObs.clear();
      await call('observar', { sesion: bd.sesion, items });
    }
  } catch (e) {
    bd.msg = (e as Error).message;
  }
  bd.version++;
}

export async function guardarDestino(x: number, z: number) {
  if (!bd.autoridad || bd.estado !== 'conectado') return;
  const p = sceneToEnu(x, z);
  await call('destino', { sesion: bd.sesion, x: +p.x.toFixed(2), y: +p.y.toFixed(2) }).catch(() => undefined);
}

/** Delete what the EVA registered and the observations (the orbital survey stays). */
export async function reiniciarEva() {
  await call('reiniciar_eva', {});
  registrados.clear();
  mejorConf.clear();
  await refrescar();
  await cargarCatalogo();
  onChange?.();
}
