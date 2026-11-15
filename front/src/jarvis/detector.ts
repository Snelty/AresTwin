// JARVIS detector (simulated sensor, see catalog.ts): 10 times a second, the
// objects inside the view frustum, in range and in line of sight (the terrain
// can hide them), with a measured size whose error grows with distance; each
// is compared with the catalogue (MySQL, jarvis/bd.ts). Rocks are identified
// by lithology (jarvis/lithology.ts: sure up close, unsure far away). NEW
// objects close enough to map are registered in the database; every
// identification is logged as an observation. NEW objects worth documenting go
// to the findings log (once each).
import * as THREE from 'three';
import { heightAt } from '../lib/terrain';
import { sceneToEnu } from '../lib/realTerrain';
import { missionView } from '../mission/mission';
import { mission } from '../mission/mission';
import { rt } from '../store/simEngine';
import { ensureField, matchObject, objectCenterY, type FieldObject, type Match } from './catalog';
import { identificar, type Identificacion } from './lithology';
import { observar, registrar, yaRegistrado } from './bd';

export interface Detection {
  o: FieldObject;
  d: number;
  rMedido: number;
  m: Match;
  prioridad: number;
  /** rocks: lithology the suit reads; anomalies: what it looks like */
  ident: Identificacion | null;
  idAnomalia: { nombre: string; conf: number } | null;
  /** angle from the centre of the view (rad) */
  ang: number;
}

/** What an anomaly looks like from here (texture and lustre need to be close). */
const ANOMALIA: Record<string, { cerca: string; lejos: string; base: number }> = {
  meteorito: { cerca: 'Hierro-níquel (meteorito)', lejos: 'Objeto oscuro brillante', base: 0.88 },
  veta: { cerca: 'Sulfato de calcio (yeso / basanita)', lejos: 'Franja clara en la roca', base: 0.82 },
  concrecion: { cerca: 'Nódulos diagenéticos', lejos: 'Esférulas oscuras', base: 0.78 },
};

export interface Hallazgo {
  id: string;
  clase: FieldObject['clase'];
  motivo: string;
  interes: number;
  /** ENU position (m) and when (simulated minutes in a mission, else real seconds since start). */
  x: number;
  y: number;
  cuando: string;
}

export const jarvis = {
  /** JARVIS view (detections, compass, panels) or the clean normal view. Shared by laptop and phone. */
  on: true,
  detections: [] as Detection[],
  /** the detection closest to the centre of the view (the analysis card) */
  foco: null as Detection | null,
  hallazgos: [] as Hallazgo[],
  vistos: 0,
  version: 0,
};

const RANGE: Record<FieldObject['clase'], number> = {
  roca: 28,
  bloque: 45,
  meteorito: 30,
  veta: 25,
  concrecion: 18,
  sitio: 160,
  habitat: 400,
  peligro: 80,
};
const MAX_SHOWN = 8;

const frustum = new THREE.Frustum();
const pv = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const center = new THREE.Vector3();
const fwd = new THREE.Vector3();
const rel = new THREE.Vector3();

/** Deterministic per-object noise in [−1, 1]. */
const hashNoise = (id: string) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967295) * 2 - 1;
};

function lineOfSight(from: THREE.Vector3, to: THREE.Vector3) {
  const n = 12;
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const x = from.x + (to.x - from.x) * k;
    const z = from.z + (to.z - from.z) * k;
    const y = from.y + (to.y - from.y) * k;
    if (heightAt(x, z) > y + 0.15) return false;
  }
  return true;
}

let clock = 0;
const t0 = performance.now();

export function stepDetector(camera: THREE.Camera, dt: number) {
  clock += dt;
  if (clock < 0.1) return;
  clock = 0;
  if (!jarvis.on) {
    if (jarvis.detections.length) {
      jarvis.detections = [];
      jarvis.foco = null;
      jarvis.version++;
    }
    return;
  }
  const f = ensureField();
  camera.updateMatrixWorld();
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(pv);
  const eye = camera.position;

  // Mission hazards are detections too (from the peligro messages).
  const hazards: FieldObject[] = missionView.activo ? missionView.peligros.map((p) => ({ id: p.id, clase: 'peligro', x: p.x, z: p.z, r: p.r, h: 1, forma: 1 })) : [];

  // Dust storm: the cameras and the lidar see less far (known places stay on the map).
  const vis = 1 - 0.65 * Math.max(0, Math.min(1, rt.stormIntensity));
  const out: Detection[] = [];
  camera.getWorldDirection(fwd);
  let foco: Detection | null = null;
  for (const o of [...f.objects, ...hazards]) {
    const d = Math.hypot(o.x - eye.x, o.z - eye.z);
    const range = o.clase === 'habitat' || o.clase === 'sitio' ? RANGE[o.clase] : RANGE[o.clase] * vis;
    if (d > range || d < 0.6) continue;
    center.set(o.x, objectCenterY(o), o.z);
    sphere.set(center, Math.max(0.3, o.r));
    if (!frustum.intersectsSphere(sphere)) continue;
    if (o.clase !== 'habitat' && o.clase !== 'sitio' && !lineOfSight(eye, center)) continue;
    // Range-finder error: 2 % + 0.25 % per metre.
    const rMedido = o.r * (1 + hashNoise(o.id) * (0.02 + 0.0025 * d));
    const ident = o.lito ? identificar(o.id, o.lito, d, o.r) : null;
    const an = ANOMALIA[o.clase];
    const idAnomalia = an ? (() => {
      const reach = Math.max(0, Math.min(1, (18 - d) / 12));
      return reach > 0.25 ? { nombre: an.cerca, conf: an.base * Math.pow(reach, 0.7) } : { nombre: an.lejos, conf: 0.85 };
    })() : null;
    const m = o.clase === 'peligro' ? { estado: 'nuevo' as const, similitud: 0, ref: null, interes: 0, motivo: 'peligro reportado' } : matchObject(o, rMedido, ident);
    const prioridad = (o.clase === 'peligro' ? 4 : 0) + m.interes * 3 + (m.estado === 'nuevo' ? 0.6 : 0) + (o.clase === 'sitio' ? 1 : 0) - d / 40;
    rel.set(o.x - eye.x, objectCenterY(o) - eye.y, o.z - eye.z).normalize();
    const ang = Math.acos(Math.max(-1, Math.min(1, rel.dot(fwd))));
    const det: Detection = { o, d, rMedido, m, prioridad, ident, idAnomalia, ang };
    out.push(det);
    // The analysis card: what sits under the reticle (within ~9°; bigger objects a bit wider).
    if (ang < 0.16 + Math.atan(o.r / Math.max(1, d)) && (!foco || ang < foco.ang)) foco = det;

    // Database (laptop only; bd.ts ignores the phone): every identification, and NEW objects mapped up close.
    if (o.clase !== 'peligro' && o.clase !== 'habitat') {
      const enu = sceneToEnu(o.x, o.z);
      const conf = ident ? ident.conf : idAnomalia ? idAnomalia.conf : m.similitud;
      observar({
        objeto_id: o.id,
        conf,
        clase: o.clase,
        estado: m.estado,
        ref_id: m.ref?.id ?? null,
        similitud: +m.similitud.toFixed(3),
        litologia_estimada: ident && !ident.generico ? ident.estimada : null,
        distancia_m: +d.toFixed(1),
        radio_medido_m: +rMedido.toFixed(3),
        x: +enu.x.toFixed(2),
        y: +enu.y.toFixed(2),
        t_mision_s: mission.modo !== 'libre' ? mission.t : null,
      });
      if (m.estado === 'nuevo' && !yaRegistrado(o.id) && o.clase !== 'sitio' && (d < 15 || m.interes >= 0.5))
        registrar(o, rMedido, ident && !ident.generico ? ident.estimada : null, conf, m.interes, m.motivo || (idAnomalia?.nombre ?? 'mapeado por la EVA'));
    }

    // A finding: worth documenting and not already documented by an EVA (an orbital entry knows no lithology).
    if (m.interes >= 0.5 && o.clase !== 'peligro' && !(m.estado === 'catalogado' && m.ref?.fuente === 'eva') && !jarvis.hallazgos.some((h) => h.id === o.id)) {
      const enu = sceneToEnu(o.x, o.z);
      jarvis.hallazgos.unshift({
        id: o.id,
        clase: o.clase,
        motivo: m.motivo,
        interes: m.interes,
        x: Math.round(enu.x * 10) / 10,
        y: Math.round(enu.y * 10) / 10,
        cuando: mission.modo !== 'libre' ? `min ${(mission.t / 60).toFixed(1)}` : `${Math.round((performance.now() - t0) / 1000)} s`,
      });
    }
  }
  out.sort((a, b) => b.prioridad - a.prioridad);
  jarvis.foco = foco;
  jarvis.vistos = out.length;
  jarvis.detections = out.slice(0, MAX_SHOWN);
  jarvis.version++;
}

// Development hook for automated checks (same module instances as the app).
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __aresJarvis?: unknown }).__aresJarvis = { jarvis, field: () => ensureField() };
