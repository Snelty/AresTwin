// Independent headset UI: terrain first, compact readouts below, circular map above.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { bio, level, LEVEL_COLOR, minutesLeft } from '../hud/bio';
import { jarvis } from '../jarvis/detector';
import { CLASE_NOMBRE } from '../jarvis/catalog';
import { drawNav } from '../nav/drawNav';
import { SITES } from '../lib/sites';
import { vrHudLayout } from './vrHudLayout';
import { HUD_FEATURES } from '../hud/features';
import { coolingAmount, temperature, THERMAL_COLORS, THERMAL_MIN_C, THERMAL_MAX_C } from '../sim/temperature';

const D = 0.6;
const FONT = 'ui-monospace, Consolas, monospace';
const CYAN = '#a3fff2';
const fmt = (v: number) => v.toFixed(1).replace('.', ',');

function panel(w: number, h: number) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  return { canvas, context, texture, material };
}

function background(g: CanvasRenderingContext2D, w: number, h: number, color: string) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(6, 14, 26, 0.26)';
  g.strokeStyle = color; g.lineWidth = 2;
  g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 14); g.fill(); g.stroke();
  g.textAlign = 'left'; g.shadowColor = '#000'; g.shadowBlur = 3; g.shadowOffsetY = 1;
}

function vitals(p: ReturnType<typeof panel>, title: string, value: string, detail: string, color: string) {
  const g = p.context;
  background(g, 360, 132, color);
  g.fillStyle = color; g.font = `bold 23px ${FONT}`; g.fillText(title, 14, 28);
  g.fillStyle = '#ffffff'; g.font = `bold 52px ${FONT}`; g.fillText(value, 14, 82);
  g.fillStyle = color; g.font = `bold 25px ${FONT}`; g.fillText(detail, 14, 116);
}

function analysis(p: ReturnType<typeof panel>) {
  const det = jarvis.foco;
  if (!det) return;
  const g = p.context;
  const site = SITES.find(s => s.code === det.o.id);
  const color = det.o.clase === 'peligro' ? LEVEL_COLOR.rojo : CYAN;
  background(g, 520, 160, color);
  g.fillStyle = color; g.font = `bold 25px ${FONT}`;
  g.fillText(`ANÁLISIS · ${det.o.id} · ${Math.round(det.d)} m`, 16, 34);
  const title = site ? site.mineral : det.ident?.nombre ?? det.idAnomalia?.nombre ?? CLASE_NOMBRE[det.o.clase];
  g.fillStyle = '#ffffff'; g.font = `bold 38px ${FONT}`;
  let short = title;
  while (short.length && g.measureText(short + (short === title ? '' : '…')).width > 484) short = short.slice(0, -1);
  g.fillText(short === title ? title : `${short}…`, 16, 86);
  g.fillStyle = color; g.font = `bold 28px ${FONT}`;
  g.fillText(det.o.clase === 'peligro' ? 'PELIGRO · evita la zona'
    : site ? `Ciencia ${site.value}/10 · ${fmt(site.massKg)} kg`
      : det.m.interes >= 0.5 ? '★ Documentar' : det.m.estado === 'nuevo' ? 'Objeto nuevo' : 'Objeto catalogado', 16, 132);
}

function climateReadout(p: ReturnType<typeof panel>, latencyMs: number) {
  const g = p.context;
  background(g, 512, 160, CYAN);
  g.fillStyle = '#ffffff'; g.font = `bold 48px ${FONT}`;
  g.fillText(`${Math.round(temperature.temperatureC)} °C`, 16, 50);
  g.textAlign = 'right'; g.fillStyle = CYAN; g.font = `bold 25px ${FONT}`;
  g.fillText(temperature.thermal ? 'TÉRMICO · SIM.' : 'FRÍO · SIM.', 496, 46);
  if (temperature.thermal) {
    const gradient = g.createLinearGradient(16, 0, 496, 0);
    THERMAL_COLORS.forEach((color, i) => gradient.addColorStop(i / (THERMAL_COLORS.length - 1), color));
    g.fillStyle = gradient; g.fillRect(16, 66, 480, 12);
    g.fillStyle = '#ffffff'; g.font = `bold 24px ${FONT}`;
    g.textAlign = 'left'; g.fillText(`${THERMAL_MIN_C} °C`, 16, 108);
    g.textAlign = 'right'; g.fillText(`+${THERMAL_MAX_C} °C`, 496, 108);
  } else {
    g.textAlign = 'center'; g.font = `bold 28px ${FONT}`;
    g.fillText(temperature.cold ? 'Enfriando el escenario' : 'Recuperando temperatura', 256, 100);
  }
  g.fillStyle = '#d8e6f2'; g.font = `bold 28px ${FONT}`; g.textAlign = 'center';
  g.fillText(Number.isFinite(latencyMs) ? `${Math.round(latencyMs)} ms` : '— ms', 256, 148);
}

export function VrHud({ stereo, latencyMs = NaN }: { stereo: boolean; latencyMs?: number }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const group = useRef<THREE.Group>(null);
  const oxygen = useRef<THREE.Mesh>(null), pulse = useRef<THREE.Mesh>(null);
  const info = useRef<THREE.Mesh>(null), map = useRef<THREE.Mesh>(null);
  const latency = useRef<THREE.Mesh>(null);
  const climate = useRef<THREE.Mesh>(null);
  const assets = useMemo(() => ({ oxygen: panel(360, 132), pulse: panel(360, 132), analysis: panel(520, 160), map: panel(520, 520), latency: panel(256, 64), climate: panel(512, 160) }), []);
  const last = useRef({ vitals: -1, map: -1 });
  useEffect(() => () => Object.values(assets).forEach(p => { p.texture.dispose(); p.material.dispose(); }), [assets]);
  useFrame(state => {
    if (!group.current || !oxygen.current || !pulse.current || !info.current || !map.current || !latency.current || !climate.current) return;
    group.current.visible = true;
    oxygen.current.visible = pulse.current.visible = map.current.visible = jarvis.on;
    const showClimate = temperature.cold || temperature.thermal || coolingAmount() > 0.02;
    climate.current.visible = showClimate;
    latency.current.visible = !showClimate;
    const t = state.clock.elapsedTime;
    if (t - last.current.vitals >= 0.125) {
      last.current.vitals = t;
      vitals(assets.oxygen, 'OXÍGENO', `${fmt(bio.O2)} L`, `${Math.round(100 * bio.O2 / Math.max(bio.O2_0, 1))}% · ≈${Math.floor(minutesLeft())} min`, LEVEL_COLOR[level()]);
      vitals(assets.pulse, 'PULSO', `${Math.round(bio.FC)} lpm`, `VO₂ ${fmt(bio.VO2)} L/min`, bio.FC > 170 ? LEVEL_COLOR.rojo : bio.FC > 150 ? LEVEL_COLOR.ambar : CYAN);
      if (HUD_FEATURES.analysis) {
        analysis(assets.analysis);
        assets.analysis.texture.needsUpdate = true;
      }
      assets.oxygen.texture.needsUpdate = assets.pulse.texture.needsUpdate = true;
      const g = assets.latency.context;
      g.clearRect(0, 0, 256, 64);
      g.font = `bold 36px ${FONT}`; g.textAlign = 'center'; g.fillStyle = '#d8e6f2';
      g.shadowColor = '#000'; g.shadowBlur = 3;
      g.fillText(Number.isFinite(latencyMs) ? `${Math.round(latencyMs)} ms` : '— ms', 128, 44);
      assets.latency.texture.needsUpdate = true;
      if (showClimate) { climateReadout(assets.climate, latencyMs); assets.climate.texture.needsUpdate = true; }
    }
    if (jarvis.on && t - last.current.map >= 0.2) {
      last.current.map = t;
      drawNav(assets.map.context, 520, 520, false, true);
      assets.map.texture.needsUpdate = true;
    }
    const halfH = D * Math.tan(camera.fov * Math.PI / 360);
    const halfW = halfH * camera.aspect / (stereo ? 2 : 1);
    const layout = vrHudLayout(halfW, halfH);
    group.current.position.copy(camera.position); group.current.quaternion.copy(camera.quaternion);
    for (const [mesh, rect] of [[oxygen.current, layout.oxygen], [pulse.current, layout.pulse], [info.current, layout.analysis], [map.current, layout.map], [latency.current, layout.latency], [climate.current, layout.climate]] as const) {
      mesh.position.set(rect.x, rect.y, -D); mesh.scale.set(rect.w, rect.h, 1);
    }
    info.current.visible = HUD_FEATURES.analysis && jarvis.on && !!jarvis.foco;
  }, 0.5);
  return <group ref={group}>
    <mesh ref={oxygen} material={assets.oxygen.material} renderOrder={1000} frustumCulled={false}><planeGeometry args={[1, 1]} /></mesh>
    <mesh ref={info} material={assets.analysis.material} renderOrder={1000} frustumCulled={false} visible={HUD_FEATURES.analysis}><planeGeometry args={[1, 1]} /></mesh>
    <mesh ref={pulse} material={assets.pulse.material} renderOrder={1000} frustumCulled={false}><planeGeometry args={[1, 1]} /></mesh>
    <mesh ref={map} material={assets.map.material} renderOrder={1000} frustumCulled={false}><planeGeometry args={[1, 1]} /></mesh>
    <mesh ref={latency} material={assets.latency.material} renderOrder={1000} frustumCulled={false}><planeGeometry args={[1, 1]} /></mesh>
    <mesh ref={climate} material={assets.climate.material} renderOrder={1000} frustumCulled={false}><planeGeometry args={[1, 1]} /></mesh>
  </group>;
}
