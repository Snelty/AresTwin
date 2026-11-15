// Data layers of the terrain package draped over the 3D relief
// (contratos/INTEGRACION.md §5.4 "Capas del mapa", §5.5 colours):
//   CRISM spectral indices → each mineral's agreed colour with transparency
//     (strength = how far the index rises above the scene's p90, the same
//     threshold the site selection uses), or all minerals at once (strongest wins);
//   slope → amber up to 30°, red where it is impassable (peligro, a safety colour);
//   TES thermal inertia → one value for the whole window (one ~3 km pixel): shown
//     as a number, not painted (a flat tint would suggest detail that is not there).
// Indices are hints, not confirmed detections (CLAUDE.md §16).
import * as THREE from 'three';
import { MINERALES, type Mineral } from './realTerrain';

export type RasterId = 'raster-tes' | 'raster-usgs' | 'raster-terreno' | 'raster-mid' | 'raster-far';
export type CapaId = 'ninguna' | 'minerales' | Mineral | 'pendiente' | RasterId;

export const CAPAS: { id: CapaId; nombre: string }[] = [
  { id: 'ninguna', nombre: 'Sin capa' },
  { id: 'raster-tes', nombre: 'Textura TIFF térmico' },
  { id: 'raster-usgs', nombre: 'Textura DEM USGS' },
  { id: 'raster-terreno', nombre: 'Textura DEM misión' },
  { id: 'raster-mid', nombre: 'Textura DEM regional' },
  { id: 'raster-far', nombre: 'Textura DEM MOLA' },
  { id: 'minerales', nombre: 'Minerales CRISM' },
  { id: 'sulfatos', nombre: 'Sulfatos' },
  { id: 'filosilicatos', nombre: 'Filosilicatos' },
  { id: 'silice', nombre: 'Sílice' },
  { id: 'hematita', nombre: 'Hematita' },
  { id: 'pendiente', nombre: 'Pendiente' },
];

// Mineral class → CRISM summary parameters (as herramientas/construir_terreno.py).
const INDICES: Record<Mineral, string[]> = {
  sulfatos: ['crism_bd1900_2', 'crism_bd2100_2'],
  filosilicatos: ['crism_d2300'],
  silice: ['crism_bd2210_2'],
  hematita: ['crism_bd860_2'],
};

interface Manifest {
  filas: number;
  columnas: number;
  capas: Record<string, { archivo: string; descripcion?: string; unidad?: string; fuente?: string }>;
}

const N = 192;
const data = new Uint8Array(N * N * 4);
export const layerTexture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
layerTexture.magFilter = THREE.LinearFilter;
layerTexture.minFilter = THREE.LinearFilter;
export const layerUniforms = {
  uLayer: { value: layerTexture as THREE.Texture }, uLayerOn: { value: 0 },
  uLayerRect: { value: new THREE.Vector4(0, 0, 480, 480) },
  uLayerRegionOn: { value: 0 },
};

export const layerState = { actual: 'ninguna' as CapaId, nota: '', tes: null as { valor: number; unidad: string; fuente: string } | null };
const listeners = new Set<() => void>();
let revision = 0;
export const layerRevision = () => revision;
export const subscribeLayers = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function notifyLayers() { revision++; listeners.forEach(listener => listener()); }

let manifest: Manifest | null = null;
const cache = new Map<string, Float32Array>();

async function getManifest() {
  if (!manifest) manifest = (await (await fetch('/terreno/manifest.json')).json()) as Manifest;
  return manifest;
}

async function layer(name: string): Promise<Float32Array | null> {
  if (cache.has(name)) return cache.get(name)!;
  const m = await getManifest();
  const c = m.capas[name];
  if (!c) return null;
  const buf = await (await fetch(`/terreno/${c.archivo}`)).arrayBuffer();
  const dv = new DataView(buf);
  const a = new Float32Array(buf.byteLength / 4);
  for (let k = 0; k < a.length; k++) a[k] = dv.getFloat32(k * 4, true);
  cache.set(name, a);
  return a;
}

/** Scene p90 written by the builder in the layer's description ("p90 de la escena = 0.0047"). */
const p90Of = (name: string) => Number(/p90 de la escena = ([\d.eE+-]+)/.exec(manifest?.capas[name]?.descripcion ?? '')?.[1] ?? NaN);

/** 0..1 strength of a mineral per cell: (v − p90) / (max − p90), NaN = no data → 0. */
async function mineralStrength(min: Mineral): Promise<Float32Array> {
  const out = new Float32Array(N * N);
  for (const name of INDICES[min]) {
    const a = await layer(name);
    if (!a) continue;
    let max = -Infinity;
    for (const v of a) if (Number.isFinite(v) && v > max) max = v;
    let p90 = p90Of(name);
    if (!Number.isFinite(p90)) p90 = 0;
    const span = Math.max(1e-9, max - p90);
    for (let k = 0; k < a.length; k++) {
      const v = a[k];
      if (Number.isFinite(v)) out[k] = Math.max(out[k], Math.min(1, Math.max(0, (v - p90) / span)));
    }
  }
  return out;
}

const rgb = (hex: string) => {
  const c = new THREE.Color(hex);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
};

/** Package rows are south-first; the texture's row 0 is north (z = −HALF). */
function put(k: number, r: number, g: number, b: number, a: number) {
  const i = k % N;
  const j = N - 1 - ((k / N) | 0);
  const o = (j * N + i) * 4;
  data[o] = r;
  data[o + 1] = g;
  data[o + 2] = b;
  data[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
}

/** Load the TES value once (shown as a number). */
export async function loadTes() {
  const m = await getManifest().catch(() => null);
  const c = m?.capas.tes_inercia_termica;
  if (!c) return;
  const a = await layer('tes_inercia_termica');
  if (!a) return;
  layerState.tes = { valor: a[(a.length / 2) | 0], unidad: c.unidad ?? '', fuente: c.fuente ?? '' };
  notifyLayers();
}

let pending = 0;
interface RenderedRaster { id: string; image: string; min: number; max: number; unit: string; textureRect: [number, number, number, number]; registered: boolean }
let rasterManifest: Promise<RenderedRaster[]> | null = null;
const rasterTextures = new Map<string, Promise<THREE.Texture>>();

async function rasterLayer(id: RasterId) {
  const base = `${import.meta.env.BASE_URL}rasters/`;
  rasterManifest ??= fetch(base + 'manifest.json').then(async r => {
    if (!r.ok) throw Error('No se encontraron las texturas de los rasters');
    return await r.json() as RenderedRaster[];
  }).catch(error => { rasterManifest = null; throw error; });
  const item = (await rasterManifest).find(r => `raster-${r.id}` === id);
  if (!item) throw Error('Raster desconocido');
  if (!rasterTextures.has(id)) {
    rasterTextures.set(id, new THREE.TextureLoader().loadAsync(base + item.image).then(texture => {
      // Preview row 0 is north; world texture v grows towards the south.
      texture.flipY = false;
      // The layer shader explicitly converts the PNG's sRGB colours to linear.
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return texture;
    }).catch(error => { rasterTextures.delete(id); throw error; }));
  }
  return { item, texture: await rasterTextures.get(id)! };
}

/** Initialise once on both laptop and headset, preserving subsequent choices. */
export function initTerrainLayer() {
  if (pending === 0) {
    let saved: string | null = null;
    try { saved = localStorage.getItem('ares.terrainLayer'); } catch { /* Storage is optional. */ }
    void setLayer(CAPAS.some(c => c.id === saved) ? saved as CapaId : 'raster-terreno');
  }
}

export async function setLayer(id: CapaId) {
  const ticket = ++pending;
  layerState.actual = id;
  layerUniforms.uLayerOn.value = 0;
  layerUniforms.uLayerRegionOn.value = 0;
  notifyLayers();
  if (id === 'ninguna') {
    layerUniforms.uLayerOn.value = 0;
    layerState.nota = '';
    notifyLayers();
    return;
  }
  if (id.startsWith('raster-')) {
    layerState.nota = 'Cargando textura del raster…';
    notifyLayers();
    try {
      const { item, texture } = await rasterLayer(id as RasterId);
      if (ticket !== pending) return;
      layerUniforms.uLayer.value = texture;
      layerUniforms.uLayerRect.value.fromArray(item.textureRect);
      layerUniforms.uLayerOn.value = 1;
      layerUniforms.uLayerRegionOn.value = item.registered ? 1 : 0;
      layerState.nota = `${item.min.toFixed(1)}–${item.max.toFixed(1)} ${item.unit}. ` + (item.registered
        ? 'Textura de elevación alineada con sus coordenadas; conserva el relieve caminable.'
        : 'TIFF sin georreferencia: textura visual ajustada a la ventana de 480 m; no representa la ubicación real de esos valores.');
    } catch (error) {
      if (ticket === pending) layerState.nota = error instanceof Error ? error.message : 'No se pudo cargar la textura';
    }
    notifyLayers();
    return;
  }
  await getManifest();
  if (ticket !== pending) return;
  data.fill(0);
  if (id === 'pendiente') {
    const s = await layer('pendiente_deg');
    if (!s || ticket !== pending) return;
    const amber = rgb('#ffb020');
    const red = rgb('#ff3b3b');
    for (let k = 0; k < s.length; k++) {
      const d = s[k];
      if (d > 30) put(k, red[0], red[1], red[2], 0.75);
      else put(k, amber[0], amber[1], amber[2], Math.max(0, (d - 8) / 22) * 0.55);
    }
    layerState.nota = 'Pendiente del DEM: ámbar hasta 30°, rojo = no transitable (peligro.bin)';
  } else {
    const list: Mineral[] = id === 'minerales' ? ['sulfatos', 'filosilicatos', 'silice', 'hematita'] : [id as Mineral];
    const strength = await Promise.all(list.map(mineralStrength));
    if (ticket !== pending) return;
    const colors = list.map((m) => rgb(MINERALES[m].color));
    for (let k = 0; k < N * N; k++) {
      let best = -1;
      let bv = 0;
      strength.forEach((s, i) => {
        if (s[k] > bv) {
          bv = s[k];
          best = i;
        }
      });
      if (best >= 0) put(k, colors[best][0], colors[best][1], colors[best][2], 0.2 + 0.65 * Math.sqrt(bv));
    }
    layerState.nota = 'Índices CRISM sobre su p90 de la escena (indicios, no detecciones). Resolución nativa 18 m.';
  }
  if (ticket !== pending) return;
  layerTexture.needsUpdate = true;
  layerUniforms.uLayer.value = layerTexture;
  layerUniforms.uLayerRect.value.set(0, 0, 480, 480);
  layerUniforms.uLayerOn.value = 1;
  notifyLayers();
}

// ---------------------------------------------------------------------------
// CRISM at a point (JARVIS analysis card): strength 0..1 of each mineral's index
// above the scene p90, in the 2.5 m cell under (x, z). Loaded once, on demand.
// ---------------------------------------------------------------------------
const crism = { estado: 'nada' as 'nada' | 'cargando' | 'listo' | 'sin datos', s: {} as Partial<Record<Mineral, Float32Array>> };

export const crismListo = () => crism.estado === 'listo';

export function cargarCrism() {
  if (crism.estado !== 'nada') return;
  crism.estado = 'cargando';
  (async () => {
    for (const m of Object.keys(INDICES) as Mineral[]) crism.s[m] = await mineralStrength(m);
    crism.estado = 'listo';
  })().catch(() => (crism.estado = 'sin datos'));
}

/** Mineral strengths at a scene point, strongest first; null until loaded (or outside the window). */
export function crismAt(x: number, z: number): { mineral: Mineral; v: number }[] | null {
  if (crism.estado !== 'listo') return null;
  const ex = x + N * 1.25; // scene → ENU (origin at the SW corner, 480 m window, 2.5 m cells)
  const ny = N * 1.25 - z;
  const j = Math.floor(ex / 2.5);
  const i = Math.floor(ny / 2.5);
  if (i < 0 || j < 0 || i >= N || j >= N) return null;
  const k = i * N + j;
  return (Object.keys(crism.s) as Mineral[]).map((m) => ({ mineral: m, v: crism.s[m]![k] })).sort((a, b) => b.v - a.v);
}
