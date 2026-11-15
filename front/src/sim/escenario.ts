// Scenario events for the free walk, fired from the laptop (they are scenario,
// not data — CLAUDE.md §13): each one changes the world, and the existing
// machinery reacts — the costmap and R(p) are recomputed, A* re-plans from the
// astronaut's feet, the suit model and the visor show the consequences.
//
//   terrain : rock fall (blocks), a mound / hill (re-shapes the DEM), loose
//             sand (O₂ ×3, the contract's 'multiplicador'), a cold shadow
//   weather : dust storm (visibility; JARVIS sees less far), solar particle
//             event: alert with a 10 min countdown, then critical → abort home
//
// Events land on the route ahead (so the plan has to react) or where the
// astronaut is looking.
import { addUserHazard, recost, removeHazard, rt, sampleRoute } from '../store/simEngine';
import { useSimStore } from '../store/useSimStore';
import { HALF, type XZ } from '../lib/terrain';
import { cancelarDestino, currentGoal, onWorldChange, vr } from '../vr/vrEngine';
import { suitState } from '../vr/suit/state';
import { bio } from '../hud/bio';
import { mission, missionAviso } from '../mission/mission';

export type Donde = 'ruta' | 'mirada';
export type EventoTerreno = 'rocks' | 'hill' | 'sand' | 'cold';

export const escena = {
  donde: 'ruta' as Donde,
  /** dust storm target intensity (0 = clear); the scene eases toward it */
  polvo: 0,
  spe: null as null | { nivel: 'alerta' | 'critico'; llegadaT: number },
  /** latest notice, sent to the phone with the world */
  aviso: null as null | { id: number; texto: string; detalle: string; nivel: 'info' | 'alerta'; hasta: number },
  version: 0,
};

let avisoId = 0;
/** The dust is being eased by a scenario event (otherwise the laptop slider owns it). */
let polvoGestion = false;
function aviso(texto: string, detalle: string, nivel: 'info' | 'alerta', ms = 5000) {
  const hasta = performance.now() + ms;
  Object.assign(missionAviso, { texto, detalle, nivel, hasta });
  escena.aviso = { id: ++avisoId, texto, detalle, nivel, hasta };
  escena.version++;
  onWorldChange?.();
}

/** Where an event lands: on the route `ahead` metres in front, or where the head looks. */
function spot(ahead: number): XZ {
  const r = rt.route;
  const lim = HALF - 18;
  let p: XZ;
  if (escena.donde === 'ruta' && r.n > 1 && r.len - rt.sAstro > ahead * 0.6) {
    p = sampleRoute(r, Math.min(r.len - 4, rt.sAstro + ahead), { x: 0, z: 0 });
  } else {
    const yaw = suitState.lookYaw;
    p = { x: vr.x + Math.sin(yaw) * ahead, z: vr.z - Math.cos(yaw) * ahead };
  }
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
  return p;
}

const TEXTO: Record<EventoTerreno, { d: number; t: string; det: (m: number) => string; nivel: 'info' | 'alerta' }> = {
  rocks: { d: 22, t: 'DESPRENDIMIENTO DE ROCAS', det: (m) => `bloques a ${m} m: la ruta los rodea`, nivel: 'alerta' },
  hill: { d: 32, t: 'RELIEVE NO CARTOGRAFIADO', det: (m) => `loma de 12 m a ${m} m: ruta recalculada`, nivel: 'info' },
  sand: { d: 18, t: 'ARENA SUELTA', det: (m) => `a ${m} m · consumo de O₂ ×3 al cruzarla`, nivel: 'info' },
  cold: { d: 20, t: 'SOMBRA FRÍA −100 °C', det: (m) => `a ${m} m · la ruta la evita si puede`, nivel: 'info' },
};

export function eventoTerreno(kind: EventoTerreno) {
  const def = TEXTO[kind];
  const p = spot(def.d);
  addUserHazard(kind, p.x, p.z);
  recost(); // costmap + R(p); the dynamic route re-plans on costVersion
  aviso(def.t, def.det(Math.round(Math.hypot(p.x - vr.x, p.z - vr.z))), def.nivel);
}

export function quitarEvento(id: string) {
  removeHazard(id);
  recost();
  onWorldChange?.();
}

export function tormentaPolvo(on: boolean) {
  escena.polvo = on ? 0.85 : 0;
  polvoGestion = true;
  escena.version++;
  if (on) aviso('TORMENTA DE POLVO', 'visibilidad reducida: seguí la ruta del visor', 'alerta');
  else aviso('POLVO DISIPÁNDOSE', 'visibilidad normal en unos segundos', 'info');
}

/** Solar particle event: alert (protons in 10 simulated minutes), then critical → abort. */
export function tormentaSolar(nivel: 'alerta' | 'critico' | null) {
  if (!nivel) {
    escena.spe = null;
    escena.version++;
    aviso('FIN DE LA ALERTA SPE', 'flujo de protones normal', 'info');
    return;
  }
  if (nivel === 'alerta') {
    escena.spe = { nivel, llegadaT: bio.t + 600 };
    escena.version++;
    aviso('ALERTA DE TORMENTA SOLAR', 'protones en 10 min: evaluá el regreso', 'alerta');
    return;
  }
  escena.spe = { nivel, llegadaT: escena.spe?.llegadaT ?? bio.t };
  escena.version++;
  abortarAlHabitat('ABORTAR · TORMENTA SOLAR', 'volver al hábitat por la ruta de escape');
}

function abortarAlHabitat(texto: string, detalle: string) {
  // Any picked destination is dropped: the route goes home.
  if (currentGoal()?.code !== 'A') cancelarDestino();
  mission.farViewUntil = performance.now() + 3000; // §14: 3 s in the far view
  aviso(texto, detalle, 'alerta', 6000);
}

/** Remove every scenario event. */
export function limpiarEscenario() {
  const ids = useSimStore.getState().hazards.filter((h) => h.id.startsWith('user')).map((h) => h.id);
  ids.forEach((id) => removeHazard(id));
  recost();
  if (escena.polvo > 0) {
    escena.polvo = 0;
    polvoGestion = true;
  }
  escena.spe = null;
  escena.version++;
  aviso('ESCENARIO LIMPIO', 'sin eventos activos', 'info', 3000);
}

/** Laptop, every frame: ease the dust in or out, and run the solar storm clock. */
export function stepEscena(dt: number) {
  if (polvoGestion) {
    const target = escena.polvo;
    rt.stormIntensity += (target - rt.stormIntensity) * (1 - Math.exp(-dt / 3));
    if (target === 0 && rt.stormIntensity < 0.01) {
      rt.stormIntensity = 0;
      polvoGestion = false;
    }
  }
  if (escena.spe?.nivel === 'alerta' && bio.t >= escena.spe.llegadaT) {
    escena.spe = { nivel: 'critico', llegadaT: escena.spe.llegadaT };
    escena.version++;
    abortarAlHabitat('PROTONES LLEGANDO · ABORTAR', 'tormenta solar crítica: volver al hábitat');
  }
}

/** Is the scene's dust the scenario's (so the laptop slider does not fight it)? */
export const polvoActivo = () => escena.polvo > 0;
