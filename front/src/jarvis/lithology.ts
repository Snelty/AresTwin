// Rock types for JARVIS, following what Curiosity found climbing Mount Sharp
// (Gale crater): laminated mudstone of the Murray formation (clay-bearing),
// the sulfate-bearing unit above it, cross-bedded eolian sandstone of the
// Stimson formation capping it in patches, dark loose basalt blocks carried in,
// and fluvial conglomerate here and there.
//
// SCENARIO, not data: each boulder of the scene gets a lithology from its height
// (stratigraphy: the sulfate unit sits higher than the clay-bearing mudstone),
// a smooth patch pattern and its own seed, the same on every device. The 3D
// rocks are tinted with it (components/canvas/Rocks.tsx) so what JARVIS says
// matches what you see.
//
// Identifying a lithology needs texture (laminae, grains, vesicles): the suit
// is sure up close, hesitates at mid range (and may confuse similar rocks),
// and beyond ~20 m only tells a light rock from a dark one.
import { HALF, heightAt, terrainInfo } from '../lib/terrain';

export type LitoId = 'lutita' | 'arenisca_sulfatos' | 'arenisca_eolica' | 'basalto' | 'conglomerado';

export interface Lito {
  nombre: string;
  corto: string;
  unidad: string;
  textura: string;
  grano: string;
  tono: 'claro' | 'medio' | 'oscuro';
  color: string;
  /** linear RGB tint for the 3D rocks */
  tint: [number, number, number];
  /** how easy it is to tell apart (best confidence up close) */
  base: number;
  muestra: string;
  interes: number;
}

export const LITOS: Record<LitoId, Lito> = {
  lutita: {
    nombre: 'Lutita laminada',
    corto: 'Lutita',
    unidad: 'fm. Murray (con arcillas)',
    textura: 'laminación milimétrica',
    grano: 'arcilla–limo',
    tono: 'medio',
    color: 'rojizo',
    tint: [0.36, 0.235, 0.165],
    base: 0.86,
    muestra: 'alta: arcillas = lago antiguo',
    interes: 0.35,
  },
  arenisca_sulfatos: {
    nombre: 'Arenisca con sulfatos',
    corto: 'Arenisca c/ sulfatos',
    unidad: 'unidad de sulfatos',
    textura: 'capas centimétricas, fracturada',
    grano: 'arena fina',
    tono: 'claro',
    color: 'ocre claro',
    tint: [0.43, 0.33, 0.225],
    base: 0.84,
    muestra: 'alta: sulfatos = evaporación',
    interes: 0.3,
  },
  arenisca_eolica: {
    nombre: 'Arenisca eólica entrecruzada',
    corto: 'Arenisca eólica',
    unidad: 'fm. Stimson (dunas antiguas)',
    textura: 'laminación entrecruzada',
    grano: 'arena media',
    tono: 'oscuro',
    color: 'gris pardo',
    tint: [0.25, 0.215, 0.19],
    base: 0.8,
    muestra: 'media: ambiente seco',
    interes: 0.15,
  },
  basalto: {
    nombre: 'Basalto (bloque suelto)',
    corto: 'Basalto',
    unidad: 'transportado, no es roca local',
    textura: 'masiva, con vesículas',
    grano: 'afanítico',
    tono: 'oscuro',
    color: 'gris oscuro',
    tint: [0.165, 0.155, 0.15],
    base: 0.9,
    muestra: 'baja: no cuenta la historia local',
    interes: 0.1,
  },
  conglomerado: {
    nombre: 'Conglomerado',
    corto: 'Conglomerado',
    unidad: 'depósito fluvial',
    textura: 'clastos redondeados de 2–20 mm',
    grano: 'grava en matriz',
    tono: 'medio',
    color: 'moteado',
    tint: [0.33, 0.26, 0.2],
    base: 0.88,
    muestra: 'alta: los guijarros redondeados = ríos',
    interes: 0.5,
  },
};

/** Look-alikes the suit can mix up at mid range. */
const CONFUSE: Record<LitoId, LitoId> = {
  lutita: 'arenisca_sulfatos',
  arenisca_sulfatos: 'lutita',
  arenisca_eolica: 'basalto',
  basalto: 'arenisca_eolica',
  conglomerado: 'arenisca_sulfatos',
};

const hash = (x: number, z: number, k: number) => {
  let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663) ^ Math.imul(k, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
/** Smooth value noise on a coarse lattice (patches tens of metres wide). */
function patch(x: number, z: number, cell: number, k: number) {
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const s = (t: number) => t * t * (3 - 2 * t);
  const v = (a: number, b: number) => hash(a * 10, b * 10, k);
  const a = v(ix, iz) + (v(ix + 1, iz) - v(ix, iz)) * s(tx);
  const b = v(ix, iz + 1) + (v(ix + 1, iz + 1) - v(ix, iz + 1)) * s(tx);
  return a + (b - a) * s(tz);
}

// Height range of the window (stratigraphy is relative to it).
const range = { version: -1, lo: 0, hi: 1 };
function heightRange() {
  if (range.version === terrainInfo.version) return range;
  range.version = terrainInfo.version;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= 24; i++)
    for (let j = 0; j <= 24; j++) {
      const h = heightAt(-HALF + (i / 24) * 2 * HALF, -HALF + (j / 24) * 2 * HALF);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  range.lo = lo;
  range.hi = Math.max(lo + 1, hi);
  return range;
}

/** Lithology of a boulder (deterministic). */
export function litologiaDe(x: number, z: number, s: number): LitoId {
  const u = hash(x, z, 1);
  if (u < (s > 1 ? 0.16 : 0.06)) return 'basalto'; // big dark blocks are often float
  if (u < (s > 1 ? 0.19 : 0.09)) return 'conglomerado';
  if (patch(x, z, 70, 2) > 0.66) return 'arenisca_eolica'; // Stimson caps in patches
  const r = heightRange();
  const hn = (heightAt(x, z) - r.lo) / (r.hi - r.lo) + (patch(x, z, 35, 3) - 0.5) * 0.35;
  return hn > 0.48 ? 'arenisca_sulfatos' : 'lutita';
}

export interface Identificacion {
  lito: LitoId;
  /** what the suit says (may be a look-alike at mid range) */
  estimada: LitoId | null;
  nombre: string;
  conf: number;
  generico: boolean;
}

/** What the suit can tell at distance d (m) about a rock of radius r (m). Deterministic per object. */
export function identificar(id: string, lito: LitoId, d: number, r: number): Identificacion {
  const L = LITOS[lito];
  // Texture needs ~3 mm/pixel: sure within ~6 m, fading out by ~22 m; bigger rocks show more.
  const reach = Math.max(0, Math.min(1, (22 + r * 4 - d) / 16));
  const conf = L.base * Math.pow(reach, 0.7);
  if (conf < 0.3) {
    const tono = L.tono === 'claro' ? 'clara' : L.tono === 'oscuro' ? 'oscura' : 'de tono medio';
    return { lito, estimada: null, nombre: `Roca ${tono}`, conf: 0.9 * Math.min(1, (60 - d) / 40), generico: true };
  }
  // Mid range: a look-alike, sometimes (fixed per object, so it does not flicker).
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const mix = (h % 1000) / 1000 < (0.62 - conf) * 1.3;
  const estimada = mix ? CONFUSE[lito] : lito;
  return { lito, estimada, nombre: LITOS[estimada].nombre, conf: mix ? conf * 0.8 : conf, generico: false };
}
