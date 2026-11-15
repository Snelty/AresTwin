// Visor navigation (the "mini map" of the suit). Computed on the laptop, the
// position authority, 10 times a second; the phone receives the numbers with
// the pose stream and draws the same map from its own copy of the route.
//
//   • next goal, distance along the route and the planned walking time to it
//     (the contract's pace on each slope: v = v0·e^(−0.042|G|)·(1 − 0.28η), §8.2)
//   • arrival in local solar time, and how far ahead or behind the plan the
//     walk is (it carries over replans: a detour shows up as lost time)
//   • "where you should be": the point of the route the plan expects you at
//   • next turn and the next steep stretch, O₂ expected at arrival and the
//     O₂ needed to walk home from there
//   • hours of daylight left; scenario events (dust, solar storm)
//
// In mission mode the goal is the optimizer's next stop and the schedule is
// its llegada_s (the plan the astronaut follows).
import { rt, sampleRoute } from '../store/simEngine';
import { cellOf, costGrid } from '../lib/costmap';
import { heightAt, sandAt } from '../lib/terrain';
import { edgeO2 } from '../lib/energy';
import { sunsetLtst } from '../lib/marsTime';
import { SITES } from '../lib/sites';
import { siteName } from '../i18n';
import { fieldAt } from '../lib/pathfinding';
import { bio, ensureReturnField } from '../hud/bio';
import { currentGoal, vr } from '../vr/vrEngine';
import { mission, missionActive, missionView } from '../mission/mission';
import { enuToScene } from '../lib/realTerrain';
import { escena } from '../sim/escenario';

const HOUR = 3699;
const SAND_FACTOR = 3; // Mars seconds per local hour (CLAUDE.md §5)

export interface NavNet {
  on: boolean;
  code: string;
  /** goal position (scene) */
  gx: number;
  gz: number;
  label: string;
  /** metres along the route to the goal, and straight line */
  dRuta: number;
  dRecta: number;
  /** planned walking seconds left, solar hour of arrival */
  etaS: number;
  llegaH: number;
  /** + behind the plan / − ahead of it (s); NaN = not started */
  atrasoS: number;
  /** next turn: −1 left, 1 right, 0 straight on; metres to it */
  giro: -1 | 0 | 1;
  giroM: number;
  /** steepest grade (%) in the next 40 m and where it starts */
  pendPct: number;
  pendM: number;
  /** O₂ expected on arrival and needed to walk home from the goal (L) */
  o2Llega: number;
  o2Vuelta: number;
  /** route progress and where the plan expects you (arc length, m) */
  s: number;
  sPlan: number;
  luzH: number;
  desvio: number;
  /** scenario: dust 0..1 and solar storm */
  polvo: number;
  spe: 'alerta' | 'critico' | null;
  speQuedaS: number;
  speVueltaS: number;
}

export const nav: NavNet & { version: number } = {
  on: false,
  code: '',
  gx: 0,
  gz: 0,
  label: '',
  dRuta: 0,
  dRecta: 0,
  etaS: 0,
  llegaH: NaN,
  atrasoS: NaN,
  giro: 0,
  giroM: 0,
  pendPct: 0,
  pendM: 0,
  o2Llega: NaN,
  o2Vuelta: NaN,
  s: 0,
  sPlan: 0,
  luzH: NaN,
  desvio: 0,
  polvo: 0,
  spe: null,
  speQuedaS: NaN,
  speVueltaS: NaN,
  version: 0,
};

// Planned time and O₂ along the current route (cumulative per vertex).
const plan = { routeId: -1, n: 0, t: new Float32Array(0), l: new Float32Array(0) };
const sched = { started: false, clock: 0, base: 0, lastDelay: 0 };

function buildPlan() {
  const r = rt.route;
  plan.routeId = vr.routeId;
  plan.n = r.n;
  plan.t = new Float32Array(r.n);
  plan.l = new Float32Array(r.n);
  const e = { litres: 0, seconds: 0, watts: 0, speed: 0 };
  for (let i = 1; i < r.n; i++) {
    const dd = r.cum[i] - r.cum[i - 1];
    const G = dd > 0.01 ? (100 * (heightAt(r.xs[i], r.zs[i]) - heightAt(r.xs[i - 1], r.zs[i - 1]))) / dd : 0;
    const k = cellOf({ x: r.xs[i], z: r.zs[i] });
    const eta = 1 + 0.9 * sandAt(r.xs[i], r.zs[i]);
    edgeO2(dd, Math.max(-60, Math.min(60, G)), eta, e);
    const f = costGrid.hazard[k] === 3 ? SAND_FACTOR : 1; // loose sand (scenario): O₂ ×3
    plan.t[i] = plan.t[i - 1] + e.seconds;
    plan.l[i] = plan.l[i - 1] + e.litres * f;
  }
}

/** Interpolate a per-vertex cumulative array at arc length s. */
function atS(arr: Float32Array, s: number) {
  const r = rt.route;
  if (r.n < 2) return 0;
  if (s <= 0) return arr[0];
  if (s >= r.len) return arr[r.n - 1];
  let lo = 0;
  let hi = r.n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (r.cum[m] <= s) lo = m;
    else hi = m;
  }
  const k = (s - r.cum[lo]) / Math.max(1e-6, r.cum[hi] - r.cum[lo]);
  return arr[lo] + (arr[hi] - arr[lo]) * k;
}

/** Arc length where the planned time reaches t. */
function sAtTime(t: number) {
  const r = rt.route;
  if (r.n < 2) return 0;
  if (t <= 0) return 0;
  if (t >= plan.t[r.n - 1]) return r.len;
  let lo = 0;
  let hi = r.n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (plan.t[m] <= t) lo = m;
    else hi = m;
  }
  const k = (t - plan.t[lo]) / Math.max(1e-6, plan.t[hi] - plan.t[lo]);
  return r.cum[lo] + (r.cum[hi] - r.cum[lo]) * k;
}

const _a = { x: 0, z: 0 };
const _b = { x: 0, z: 0 };
const _c = { x: 0, z: 0 };
const dirAt = (s: number) => {
  sampleRoute(rt.route, s, _a);
  sampleRoute(rt.route, s + 5, _b);
  return Math.atan2(_b.x - _a.x, -(_b.z - _a.z));
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Next turn sharper than 35° within 80 m (directions over 5 m windows). */
function nextTurn(s0: number, sEnd: number): { dir: -1 | 0 | 1; m: number } {
  const h0 = dirAt(s0);
  for (let s = s0 + 3; s < Math.min(sEnd - 4, s0 + 80); s += 2) {
    const d = wrap(dirAt(s) - h0);
    if (Math.abs(d) > (35 * Math.PI) / 180) return { dir: d > 0 ? 1 : -1, m: s - s0 };
  }
  return { dir: 0, m: Math.min(80, sEnd - s0) };
}

/** Steepest grade over the next 40 m, measured over 4 m. */
function nextSlope(s0: number, sEnd: number) {
  let best = 0;
  let at = 0;
  for (let s = s0; s < Math.min(sEnd - 4, s0 + 40); s += 2) {
    sampleRoute(rt.route, s, _a);
    sampleRoute(rt.route, s + 4, _c);
    const G = (100 * (heightAt(_c.x, _c.z) - heightAt(_a.x, _a.z))) / 4;
    if (Math.abs(G) > Math.abs(best)) {
      best = G;
      at = s - s0;
    }
  }
  return { G: best, m: at };
}

function goalNow(): { code: string; label: string; x: number; z: number; s: number; llegada?: number; salida?: number } | null {
  const r = rt.route;
  if (missionActive()) {
    if (mission.abortado) return { code: 'A', label: 'Hábitat · ESCAPE', x: r.xs[r.n - 1], z: r.zs[r.n - 1], s: r.len };
    const p = mission.plan?.paradas.find((q) => missionView.sitios[q.id]?.s === 'next');
    if (!p) return r.n > 1 ? { code: 'A', label: 'Hábitat', x: r.xs[r.n - 1], z: r.zs[r.n - 1], s: r.len } : null;
    const q = enuToScene(p.x, p.y);
    // The stop on the route: the closest vertex ahead of the astronaut.
    let best = Infinity;
    let sStop = r.len;
    for (let i = 0; i < r.n; i++) {
      if (r.cum[i] < rt.sAstro - 2) continue;
      const d = Math.hypot(r.xs[i] - q.x, r.zs[i] - q.z);
      if (d < best) {
        best = d;
        sStop = r.cum[i];
      }
      if (best < 1.5 && d > 10) break;
    }
    const site = SITES.find((s) => s.realId === p.id);
    return { code: `S${p.id}`, label: `S${p.id} · ${site?.mineral ?? 'sitio'}`, x: q.x, z: q.z, s: sStop, llegada: p.llegada_s, salida: p.salida_s };
  }
  const g = currentGoal();
  if (!g || r.n < 2) return null;
  const site = SITES.find((s) => s.code === g.code);
  const label = g.code === 'D' ? 'Destino marcado' : g.code === 'A' ? 'Hábitat' : `${g.code} · ${site?.mineralKey ? site.mineral : siteName(g.code, site?.name ?? g.code)}`;
  return { code: g.code, label, x: g.x, z: g.z, s: r.len };
}

let acc = 0;
/** Laptop: advance the schedule and refresh the numbers (cheap; 10 Hz). */
export function stepNav(dt: number) {
  const g0 = goalNow();
  // The EVA clock starts when the astronaut first moves.
  if (!sched.started && (vr.speed > 0.3 || missionActive())) sched.started = true;
  if (sched.started && g0) sched.clock += dt;
  acc += dt;
  if (acc < 0.1) return;
  acc = 0;

  if (plan.routeId !== vr.routeId || plan.n !== rt.route.n) {
    // New route: the delay so far carries over.
    sched.base = sched.lastDelay;
    sched.clock = 0;
    buildPlan();
  }
  const g = g0;
  nav.on = !!g;
  nav.polvo = rt.stormIntensity;
  nav.spe = missionActive() ? ((missionView.spe as 'alerta' | 'critico' | null) ?? null) : escena.spe?.nivel ?? null;
  nav.speQuedaS = !missionActive() && escena.spe ? Math.max(0, escena.spe.llegadaT - bio.t) : NaN;
  const f = ensureReturnField();
  nav.speVueltaS = fieldAt(f, { x: vr.x, z: vr.z }, 'time');
  const set = rt.sun ? sunsetLtst(rt.lat, rt.mars.decl) : NaN;
  nav.luzH = Number.isFinite(set) ? set - rt.sun.ltst : NaN;
  nav.desvio = vr.lastDeviation;
  if (!g) {
    nav.version++;
    return;
  }
  const s = Math.min(rt.sAstro, g.s);
  nav.code = g.code;
  nav.label = g.label;
  nav.gx = g.x;
  nav.gz = g.z;
  nav.s = s;
  nav.dRuta = Math.max(0, g.s - s);
  nav.dRecta = Math.hypot(g.x - vr.x, g.z - vr.z);
  const tNow = atS(plan.t, s);
  nav.etaS = Math.max(0, atS(plan.t, g.s) - tNow);
  const ltst = rt.sun?.ltst ?? NaN;
  if (missionActive() && g.llegada !== undefined) {
    // Optimizer's schedule: the stop's llegada_s against now + the walk left.
    const t = mission.t;
    // At the stop (drilling): only late if still there after the planned departure.
    nav.atrasoS = nav.dRuta < 4 && g.salida !== undefined ? Math.max(0, t - g.salida) : t + nav.etaS - g.llegada;
    nav.llegaH = ltst + nav.etaS / HOUR;
  } else {
    const delay = sched.started ? sched.base + (sched.clock - tNow) : NaN;
    if (Number.isFinite(delay)) sched.lastDelay = delay;
    nav.atrasoS = delay;
    nav.llegaH = ltst + nav.etaS / HOUR;
  }
  // Where the plan expects you: as far along as the planned time allows (behind you when ahead).
  nav.sPlan = Number.isFinite(nav.atrasoS) ? Math.max(0, Math.min(g.s, sAtTime(tNow + nav.atrasoS))) : s;
  const turn = nextTurn(s, g.s);
  nav.giro = turn.dir;
  nav.giroM = turn.m;
  const sl = nextSlope(s, g.s);
  nav.pendPct = sl.G;
  nav.pendM = sl.m;
  const litres = (atS(plan.l, g.s) - atS(plan.l, s)) * bio.fatigue + bio.leakLpm * (nav.etaS / 60);
  nav.o2Llega = bio.O2 - litres;
  nav.o2Vuelta = g.code === 'A' ? 0 : fieldAt(f, { x: g.x, z: g.z });
  nav.version++;
}

/** Restart the schedule (new EVA). */
export function resetNav() {
  sched.started = false;
  sched.clock = 0;
  sched.base = 0;
  sched.lastDelay = 0;
  plan.routeId = -1;
}

export const navSnapshot = (): NavNet => {
  const { version: _v, ...rest } = nav;
  void _v;
  return rest;
};

/** Phone: take the laptop's numbers. */
export function applyNav(n: NavNet) {
  Object.assign(nav, n);
  nav.version++;
}
