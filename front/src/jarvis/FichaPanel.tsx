// The analysis card on the visor (upper-left corner, mirroring the map): what
// sits under the reticle, as a field geologist would want it — what it is and
// how sure, the unit it belongs to, texture and grain, measured size, what the
// database knows about it, the CRISM index on that spot, and what to do.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { jarvis, type Detection } from './detector';
import { CLASE_NOMBRE } from './catalog';
import { LITOS } from './lithology';
import { bd } from './bd';
import { crismAt, crismListo, cargarCrism } from '../lib/layers';
import { MINERALES, REAL } from '../lib/realTerrain';
import { SITES } from '../lib/sites';
import { LEVEL_COLOR } from '../hud/bio';

const FONT = 'ui-monospace, Consolas, "Courier New", monospace';
const CYAN = '#00f3ff';
const STAR = '#ffd84d';
const W = 520;
const H = 640;
const D = 0.6;
const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
const pct = (v: number) => `${Math.round(v * 100)} %`;

function drawFicha(g: CanvasRenderingContext2D, det: Detection | null) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(6, 14, 26, 0.62)';
  g.strokeStyle = CYAN;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(4, 4, W - 8, H - 8, 26);
  g.fill();
  g.stroke();
  let y = 52;
  const line = (t: string, col = '#d8e6f2', size = 28, bold = false, gap = 12) => {
    let s = size;
    g.font = `${bold ? 'bold ' : ''}${s}px ${FONT}`;
    while (s > 18 && g.measureText(t).width > W - 48) g.font = `${bold ? 'bold ' : ''}${(s -= 2)}px ${FONT}`;
    g.fillStyle = col;
    g.fillText(t, 24, y);
    y += s + gap;
  };
  g.textAlign = 'left';
  g.fillStyle = CYAN;
  g.font = `24px ${FONT}`;
  g.fillText(`ANÁLISIS${det ? ` · ${det.o.id}` : ''}`, 24, y);
  g.textAlign = 'right';
  g.fillStyle = bd.estado === 'conectado' ? LEVEL_COLOR.ok : '#8aa0b4';
  g.fillText(bd.estado === 'conectado' ? '● BD' : '○ BD local', W - 24, y);
  g.textAlign = 'left';
  y += 46;

  if (!det) {
    line('Apuntá la retícula a', '#d8e6f2', 30);
    line('una roca u objeto.', '#d8e6f2', 30);
    y += 10;
    line('Los rasgos (láminas, granos,', '#8aa0b4', 24);
    line('vesículas) se distinguen a', '#8aa0b4', 24);
    line('menos de ~10 m.', '#8aa0b4', 24);
    return;
  }
  const o = det.o;
  const m = det.m;

  // What it is, and how sure.
  if (det.ident) {
    const L = LITOS[det.ident.estimada ?? det.ident.lito];
    line(det.ident.generico ? det.ident.nombre : `${det.ident.nombre}${det.ident.conf < 0.6 ? ' ?' : ''}`, '#ffffff', 34, true, 8);
    line(det.ident.generico ? `tono · seguro ${pct(det.ident.conf)}` : `confianza ${pct(det.ident.conf)}`, det.ident.conf >= 0.6 ? LEVEL_COLOR.ok : LEVEL_COLOR.ambar, 26, true);
    if (!det.ident.generico) {
      line(L.unidad, '#d8e6f2', 26);
      line(`${L.textura}`, '#d8e6f2', 24);
      line(`grano ${L.grano} · ${L.color}`, '#d8e6f2', 24);
    } else line('acercate a < 15 m para la litología', LEVEL_COLOR.ambar, 24);
  } else if (det.idAnomalia) {
    line(det.idAnomalia.nombre, '#ffffff', 32, true, 8);
    line(`confianza ${pct(det.idAnomalia.conf)}`, det.idAnomalia.conf >= 0.6 ? LEVEL_COLOR.ok : LEVEL_COLOR.ambar, 26, true);
    line(CLASE_NOMBRE[o.clase], '#d8e6f2', 24);
  } else if (o.clase === 'sitio') {
    const s = SITES.find((q) => q.code === o.id);
    line(`Sitio ${o.id} · ${s?.mineral ?? ''}`, '#ffffff', 32, true);
    if (s) {
      line(`valor científico ${s.value}/10`, '#d8e6f2', 26);
      line(`muestra ${fmt(s.massKg)} kg · perforar ${s.drillMin} min`, '#d8e6f2', 24);
      line(`ventana ${fmt(s.window[0])}–${fmt(s.window[1])} h solar`, '#d8e6f2', 24);
    }
  } else if (o.clase === 'peligro') {
    line(`PELIGRO ${o.id}`, LEVEL_COLOR.rojo, 34, true);
    line(`radio ${fmt(o.r)} m · reportado por el escenario`, '#d8e6f2', 24);
  } else line(CLASE_NOMBRE[o.clase], '#ffffff', 32, true);

  // Measurement.
  if (o.clase !== 'sitio' && o.clase !== 'habitat' && o.clase !== 'peligro') line(`tamaño ${fmt(det.rMedido * 2)} m ± ${fmt(det.rMedido * 2 * (0.02 + 0.0025 * det.d), 2)} · a ${Math.round(det.d)} m`, '#d8e6f2', 24);
  else line(`a ${Math.round(det.d)} m`, '#d8e6f2', 24);

  // What the database knows.
  if (o.clase !== 'peligro') {
    const ref = m.ref;
    const txt =
      m.estado === 'catalogado'
        ? `BD: ${ref?.fuente === 'eva' ? 'registrado por la EVA' : 'relevamiento orbital'} ${ref?.id ?? ''} · ${pct(m.similitud)}`
        : m.estado === 'similar'
          ? `BD: parecido a ${ref?.id ?? '?'} · ${pct(m.similitud)}`
          : 'BD: NUEVO · se registra al acercarte';
    line(txt, m.estado === 'nuevo' ? '#ff4fd8' : CYAN, 24, true);
    if (m.estado === 'catalogado' && ref?.fuente === 'orbital' && det.ident && !det.ident.generico) line('la órbita no conocía su litología', '#8aa0b4', 22);
  }

  // CRISM on that spot (an index, not a detection).
  if (REAL) {
    const c = crismAt(o.x, o.z);
    if (c) {
      const top = c.filter((q) => q.v > 0.05).slice(0, 2);
      line(top.length ? `CRISM aquí: ${top.map((q) => `${MINERALES[q.mineral].nombre.toLowerCase()} ${pct(q.v)}`).join(' · ')}` : 'CRISM aquí: sin índice destacado', '#d8e6f2', 22);
    } else cargarCrism();
  }

  // What to do.
  y = Math.max(y, H - 110);
  if (m.interes >= 0.5) {
    line('★ DOCUMENTAR Y MUESTREAR', STAR, 30, true, 6);
    line(m.motivo, '#d8e6f2', 22);
  } else if (det.ident && !det.ident.generico) line(`muestra: ${LITOS[det.ident.estimada ?? det.ident.lito].muestra}`, '#d8e6f2', 22);
  else if (det.ident) line('acercate para identificarla', LEVEL_COLOR.ambar, 24);
}

export function FichaPanel({ stereo = false }: { stereo?: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const mesh = useRef<THREE.Mesh>(null);
  const p = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    return { c, g: c.getContext('2d')!, t, at: 0, key: '' };
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: p.t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0.95 }), [p]);
  useEffect(
    () => () => {
      p.t.dispose();
      mat.dispose();
    },
    [p, mat],
  );

  useFrame((state) => {
    const me = mesh.current;
    if (!me) return;
    me.visible = jarvis.on;
    if (!me.visible) return;
    const t = state.clock.elapsedTime;
    const f = jarvis.foco;
    // Redraw when the target, its numbers or the database state change (at most 6 Hz).
    const key = f ? `${f.o.id}|${Math.round(f.d)}|${f.m.estado}|${Math.round((f.ident?.conf ?? f.m.similitud) * 20)}|${bd.estado}|${bd.rev}|${crismListo()}` : `none|${bd.estado}`;
    if (key !== p.key && t - p.at > 0.16) {
      p.key = key;
      p.at = t;
      drawFicha(p.g, f);
      p.t.needsUpdate = true;
    }
    const halfH = D * Math.tan(((camera.fov ?? 70) * Math.PI) / 360);
    const halfW = halfH * (camera.aspect / (stereo ? 2 : 1));
    const ph = Math.min(halfH * 0.72, halfW * 0.5 * (H / W));
    const pw = ph * (W / H);
    me.position.copy(camera.position);
    me.quaternion.copy(camera.quaternion);
    me.translateX(-halfW + pw * 0.5 + halfW * 0.04);
    me.translateY(halfH * 0.72 - ph * 0.5);
    me.translateZ(-D);
    me.rotateY(0.22);
    me.scale.set(pw, ph, 1);
  }, 0.5);

  return (
    <mesh ref={mesh} material={mat} renderOrder={1000} frustumCulled={false} visible={false}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
