// The suit's navigation panel, drawn on a canvas: a heading-up mini map (the
// HiRISE orthophoto with the relief shaded on top, the route, where the plan
// expects you, sites, hazards and the habitat) and, under it, the numbers the
// astronaut needs: next goal, distance, time and arrival, ahead / behind the
// plan, next turn and steep stretch, O₂ on arrival, solar storm countdown.
// The same drawing goes on the visor (both eyes) and on the laptop.
import { rt } from '../store/simEngine';
import { useSimStore } from '../store/useSimStore';
import { HALF, WORLD_SIZE, BASE_A, heightAt } from '../lib/terrain';
import { REAL, MINERALES } from '../lib/realTerrain';
import { SITES } from '../lib/sites';
import { vr } from '../vr/vrEngine';
import { missionView } from '../mission/mission';
import { LEVEL_COLOR } from '../hud/bio';
import { nav } from './nav';
import { suitState } from '../vr/suit/state';

const FONT = 'ui-monospace, Consolas, "Courier New", monospace';
const CYAN = '#00f3ff';
const GOLD = '#ffd84d';
const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
export const NAV_W = 520;
export const NAV_H = 880;
const MAP = 520; // the map is the square on top
/** Map range: metres from the astronaut to the rim (the laptop zooms it: 40 / 65 / 120 / 240). */
export const mapa = { rango: 65 };
export const RANGOS = [40, 65, 120, 240];

/** m:ss, or h:mm:ss over an hour. */
export function mmss(s: number) {
  if (!Number.isFinite(s)) return '—';
  const a = Math.round(Math.abs(s));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const ss = String(a % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
const hhmm = (h: number) => {
  if (!Number.isFinite(h)) return '—';
  const x = ((h % 24) + 24) % 24;
  return `${String(Math.floor(x)).padStart(2, '0')}:${String(Math.floor((x % 1) * 60)).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// Background: orthophoto (real terrain) or albedo-free shading, + relief shade
// ---------------------------------------------------------------------------
const bg = { canvas: null as HTMLCanvasElement | null, key: '', photo: null as HTMLImageElement | null, photoTried: false };

function background(): HTMLCanvasElement | null {
  const version = useSimStore.getState().terrainVersion;
  if (!version) return null;
  if (REAL && !bg.photoTried) {
    bg.photoTried = true;
    const img = new Image();
    img.onload = () => {
      bg.photo = img;
      bg.key = ''; // rebuild with the photo
    };
    img.src = '/terreno/ortofoto.jpg';
  }
  const key = `${version}|${bg.photo ? 1 : 0}`;
  if (bg.canvas && bg.key === key) return bg.canvas;
  const N = 384;
  const c = bg.canvas ?? document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  // Orthophoto: row 0 = north = −z, the same orientation as the canvas.
  if (bg.photo) g.drawImage(bg.photo, 0, 0, N, N);
  else {
    g.fillStyle = '#7a4a2c';
    g.fillRect(0, 0, N, N);
  }
  // Relief shading (light from the northwest), so scenario hills show up too.
  const img = g.getImageData(0, 0, N, N);
  const step = WORLD_SIZE / N;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = -HALF + (i + 0.5) * step;
      const z = -HALF + (j + 0.5) * step;
      const dx = heightAt(x + step, z) - heightAt(x - step, z);
      const dz = heightAt(x, z + step) - heightAt(x, z - step);
      const shade = Math.max(0.35, Math.min(1.5, 1 - (dx + dz) * 0.35));
      const k = (j * N + i) * 4;
      // HiRISE colour reads bluish-grey: pull it toward the ochre of the 3D ground.
      const l = (img.data[k] + img.data[k + 1] + img.data[k + 2]) / 3;
      img.data[k] = Math.min(255, (l * 1.25 + 18) * shade);
      img.data[k + 1] = Math.min(255, (l * 0.92 + 6) * shade);
      img.data[k + 2] = Math.min(255, l * 0.62 * shade);
    }
  g.putImageData(img, 0, 0);
  bg.canvas = c;
  bg.key = key;
  return c;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function shape(g: CanvasRenderingContext2D, forma: string, x: number, y: number, r: number) {
  g.beginPath();
  if (forma === 'rombo') {
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
  } else if (forma === 'triangulo') {
    g.moveTo(x, y - r);
    g.lineTo(x + r, y + r * 0.8);
    g.lineTo(x - r, y + r * 0.8);
    g.closePath();
  } else if (forma === 'cuadrado') g.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  else g.arc(x, y, r, 0, Math.PI * 2);
}

/** Canvas pixel of the map → scene point (heading-up map around the astronaut); null outside the map. */
export function mapToWorld(px: number, py: number, w = NAV_W): { x: number; z: number } | null {
  const cx = w / 2;
  const cy = MAP * 0.56;
  const R = MAP / 2 - 22;
  if (Math.hypot(px - cx, py - cy) > R) return null;
  const k = R / mapa.rango;
  const h = vr.heading;
  const a = (px - cx) / k;
  const b = (cy - py) / k;
  return { x: vr.x + a * Math.cos(h) + b * Math.sin(h), z: vr.z + a * Math.sin(h) - b * Math.cos(h) };
}

export function drawNav(g: CanvasRenderingContext2D, w = NAV_W, h = NAV_H) {
  g.clearRect(0, 0, w, h);
  // Panel
  g.fillStyle = 'rgba(6, 14, 26, 0.62)';
  g.strokeStyle = CYAN;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, 26);
  g.fill();
  g.stroke();

  const cx = w / 2;
  const cy = MAP * 0.56; // the astronaut sits low: more of the way ahead is shown
  const R = MAP / 2 - 22;
  const k = R / mapa.rango; // px per metre
  const head = vr.heading;
  const fx = Math.sin(head);
  const fz = -Math.cos(head);
  const rx = Math.cos(head);
  const rz = Math.sin(head);
  const toS = (x: number, z: number): [number, number] => {
    const dx = x - vr.x;
    const dz = z - vr.z;
    return [cx + (dx * rx + dz * rz) * k, cy - (dx * fx + dz * fz) * k];
  };

  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  // Map image under the heading-up transform.
  const img = background();
  if (img) {
    g.save();
    g.translate(cx, cy);
    g.rotate(-head);
    g.scale(k, k);
    g.translate(-vr.x, -vr.z);
    g.globalAlpha = 0.9;
    g.drawImage(img, -HALF, -HALF, WORLD_SIZE, WORLD_SIZE);
    g.restore();
  }
  g.fillStyle = 'rgba(4, 10, 20, 0.25)';
  g.fillRect(0, 0, w, MAP);
  // Range rings: 25 and 50 m.
  g.strokeStyle = 'rgba(0, 243, 255, 0.35)';
  g.lineWidth = 2;
  g.setLineDash([8, 10]);
  for (const m of mapa.rango > 100 ? [50, 100, 200] : [25, 50]) {
    if (m > mapa.rango) continue;
    g.beginPath();
    g.arc(cx, cy, m * k, 0, Math.PI * 2);
    g.stroke();
  }
  g.setLineDash([]);

  // Hazards: scenario (free walk) and the optimizer's (mission).
  const hazards = useSimStore.getState().hazards;
  for (const hz of hazards) {
    const [sx, sy] = toS(hz.x, hz.z);
    const col = hz.kind === 'rocks' ? LEVEL_COLOR.rojo : hz.kind === 'cold' ? '#bfe0ff' : hz.kind === 'sand' ? '#e8b878' : '#d9b48a';
    g.fillStyle = hz.kind === 'rocks' ? 'rgba(255,59,59,0.28)' : hz.kind === 'cold' ? 'rgba(190,224,255,0.22)' : hz.kind === 'sand' ? 'rgba(232,184,120,0.3)' : 'rgba(217,180,138,0.12)';
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(sx, sy, hz.r * k, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (hz.kind === 'hill') {
      for (const f of [0.66, 0.33]) {
        g.beginPath();
        g.arc(sx, sy, hz.r * k * f, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  if (missionView.activo)
    for (const p of missionView.peligros) {
      const [sx, sy] = toS(p.x, p.z);
      g.fillStyle = p.efecto === 'bloqueo' ? 'rgba(255,59,59,0.3)' : 'rgba(255,176,32,0.25)';
      g.strokeStyle = p.efecto === 'bloqueo' ? LEVEL_COLOR.rojo : LEVEL_COLOR.ambar;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(sx, sy, Math.max(4, p.r * k), 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

  // Route: walked part grey (40 %), the way ahead thick and light, the escape dashed.
  const r = rt.route;
  if (r.n > 1) {
    const drawPart = (from: number, to: number) => {
      g.beginPath();
      let first = true;
      for (let i = 0; i < r.n; i++) {
        const s = r.cum[i];
        if (s < from - 1 || s > to + 1) continue;
        const [sx, sy] = toS(r.xs[i], r.zs[i]);
        if (first) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
        first = false;
      }
      g.stroke();
    };
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = 'rgba(160,170,180,0.4)';
    g.lineWidth = 7;
    drawPart(0, nav.s);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 15;
    drawPart(nav.s, r.len);
    g.strokeStyle = '#e8fbff';
    g.lineWidth = 9;
    drawPart(nav.s, r.len);
  }
  if (missionView.activo && missionView.escape) {
    g.strokeStyle = LEVEL_COLOR.ambar;
    g.lineWidth = 4;
    g.setLineDash([12, 10]);
    g.beginPath();
    missionView.escape.forEach(([x, z], i) => {
      const [sx, sy] = toS(x, z);
      if (i) g.lineTo(sx, sy);
      else g.moveTo(sx, sy);
    });
    g.stroke();
    g.setLineDash([]);
  }

  // Sites (mineral colour and shape, CLAUDE.md §14); done ones grey.
  for (const s of SITES) {
    const [sx, sy] = toS(s.x, s.z);
    if (Math.hypot(sx - cx, sy - cy) > R + 14) continue;
    const m = s.mineralKey ? MINERALES[s.mineralKey] : null;
    const st = missionView.activo ? missionView.sitios[s.realId ?? -1]?.s : undefined;
    const done = st === 'done';
    g.fillStyle = done ? '#7d858c' : (m?.color ?? '#00c8ff');
    g.strokeStyle = s.code === nav.code ? GOLD : '#ffffff';
    g.lineWidth = s.code === nav.code ? 5 : 2.5;
    shape(g, m?.forma ?? 'circulo', sx, sy, s.code === nav.code ? 15 : 11);
    g.fill();
    g.stroke();
  }

  // Where the plan expects you (only if it is somewhere else).
  if (r.n > 1 && Number.isFinite(nav.atrasoS) && Math.abs(nav.sPlan - nav.s) > 2.5) {
    const p = { x: 0, z: 0 };
    let lo = 0;
    while (lo < r.n - 1 && r.cum[lo + 1] < nav.sPlan) lo++;
    const t = (nav.sPlan - r.cum[lo]) / Math.max(1e-6, (r.cum[lo + 1] ?? r.cum[lo]) - r.cum[lo]);
    p.x = r.xs[lo] + ((r.xs[lo + 1] ?? r.xs[lo]) - r.xs[lo]) * Math.min(1, t);
    p.z = r.zs[lo] + ((r.zs[lo + 1] ?? r.zs[lo]) - r.zs[lo]) * Math.min(1, t);
    const [sx, sy] = toS(p.x, p.z);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4;
    g.setLineDash([6, 5]);
    g.beginPath();
    g.arc(sx, sy, 13, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#ffffff';
    g.font = `bold 22px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('PLAN', sx, sy - 20);
  }
  g.restore();

  // Habitat and goal: pinned to the rim when off the map.
  const pin = (x: number, z: number, txt: string, col: string) => {
    let [sx, sy] = toS(x, z);
    const dx = sx - cx;
    const dy = sy - cy;
    const d = Math.hypot(dx, dy);
    const off = d > R - 10;
    if (off) {
      sx = cx + (dx / d) * (R - 10);
      sy = cy + (dy / d) * (R - 10);
    }
    g.fillStyle = col;
    g.strokeStyle = '#000';
    g.lineWidth = 3;
    g.beginPath();
    if (txt === 'H') g.rect(sx - 14, sy - 14, 28, 28);
    else g.arc(sx, sy, 14, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#05101c';
    g.font = `bold 20px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(txt, sx, sy + 7);
    if (off) {
      g.fillStyle = col;
      g.font = `bold 20px ${FONT}`;
      g.fillText(`${Math.round(Math.hypot(x - vr.x, z - vr.z))} m`, sx - (dx / d) * 34, sy - (dy / d) * 34 + 7);
    }
  };
  pin(BASE_A.x, BASE_A.z, 'H', '#ffffff');
  if (nav.on && nav.code !== 'A') pin(nav.gx, nav.gz, nav.code === 'D' ? '◎' : '★', GOLD);

  // Rim, north mark and the astronaut.
  g.strokeStyle = CYAN;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.stroke();
  const [nx, ny] = [cx + Math.sin(-head) * (R - 2), cy - Math.cos(-head) * (R - 2)];
  g.fillStyle = '#ff6b6b';
  g.font = `bold 28px ${FONT}`;
  g.textAlign = 'center';
  g.fillText('N', nx, ny + 10);
  // view cone (where the head looks)
  const look = suitState.lookYaw - head;
  g.fillStyle = 'rgba(0,243,255,0.16)';
  g.beginPath();
  g.moveTo(cx, cy);
  g.arc(cx, cy, 70, -Math.PI / 2 + look - 0.5, -Math.PI / 2 + look + 0.5);
  g.closePath();
  g.fill();
  g.fillStyle = CYAN;
  g.strokeStyle = '#001018';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx, cy - 22);
  g.lineTo(cx + 15, cy + 14);
  g.lineTo(cx, cy + 6);
  g.lineTo(cx - 15, cy + 14);
  g.closePath();
  g.fill();
  g.stroke();
  // Scale bar: a round length about a fifth of the map.
  const bar = [10, 20, 50, 100].find((m) => m * k >= 70) ?? 100;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(30, MAP - 26);
  g.lineTo(30 + bar * k, MAP - 26);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `20px ${FONT}`;
  g.textAlign = 'left';
  g.fillText(`${bar} m`, 30, MAP - 36);

  // ---- Numbers ----
  let y = MAP + 44;
  const line = (txt: string, col = '#d8e6f2', size = 32, bold = false) => {
    g.fillStyle = col;
    let s = size;
    g.font = `${bold ? 'bold ' : ''}${s}px ${FONT}`;
    while (s > 20 && g.measureText(txt).width > w - 48) g.font = `${bold ? 'bold ' : ''}${(s -= 2)}px ${FONT}`;
    g.fillText(txt, 24, y);
    y += s + 14;
  };
  g.textAlign = 'left';
  if (!nav.on) {
    line('⌂ EN EL HÁBITAT', CYAN, 36, true);
    line('marcá un destino en el mapa', '#d8e6f2', 28);
    line('sin destino: la ruta vuelve aquí', '#8aa0b4', 24);
  } else {
    line(`► ${nav.label}`, GOLD, 38, true);
    line(`${Math.round(nav.dRuta)} m · ${mmss(nav.etaS)} · llega ${hhmm(nav.llegaH)}`, '#ffffff', 32, true);
    const a = nav.atrasoS;
    const sched = !Number.isFinite(a) ? 'horario: empieza al caminar' : Math.abs(a) < 20 ? '● en horario' : a > 0 ? `▼ ${mmss(a)} atrasado` : `▲ ${mmss(a)} adelantado`;
    const turn = nav.giro === 0 ? `↑ recto ${Math.round(nav.giroM)} m` : `${nav.giro < 0 ? '↰ izq.' : '↱ der.'} en ${Math.round(nav.giroM)} m`;
    line(`${sched} · ${turn}`, Number.isFinite(a) && a > 60 ? '#ffe0a0' : '#d8e6f2', 30);
    // O₂ on arrival: the safety colour of the margin it leaves to walk home.
    const m = nav.o2Vuelta > 0.05 ? 100 * (nav.o2Llega / nav.o2Vuelta - 1) : Infinity;
    const col = nav.o2Llega <= 0 ? LEVEL_COLOR.rojo : m > 30 ? LEVEL_COLOR.ok : m > 15 ? LEVEL_COLOR.ambar : LEVEL_COLOR.rojo;
    line(`O₂ al llegar ${fmt(Math.max(0, nav.o2Llega))} L · volver ${fmt(nav.o2Vuelta)} L`, col, 30, true);
    if (Math.abs(nav.pendPct) > 12) line(`${nav.pendPct > 0 ? '⬈ subida' : '⬊ bajada'} ${Math.round(Math.abs(nav.pendPct))} % en ${Math.round(nav.pendM)} m`, '#d8e6f2', 28);
  }
  if (nav.spe) {
    const crit = nav.spe === 'critico';
    line(crit ? '☢ SPE CRÍTICO · al hábitat' : `☢ protones en ${mmss(nav.speQuedaS)} · vuelta ${mmss(nav.speVueltaS)}`, crit || nav.speVueltaS > nav.speQuedaS ? LEVEL_COLOR.rojo : LEVEL_COLOR.ambar, 30, true);
  } else if (nav.polvo > 0.15) line(`≋ tormenta de polvo · τ ${fmt(0.6 + 3.4 * nav.polvo)} · poca visibilidad`, LEVEL_COLOR.ambar, 28);
  else if (Number.isFinite(nav.luzH) && nav.luzH < 2) line(nav.luzH > 0 ? `☀ luz: ${mmss(nav.luzH * 3699)}` : '☾ de noche', LEVEL_COLOR.ambar, 28);
}
