// Laptop menu pieces: the scenario events tab ("Simular"), the navigation tab,
// and the small building blocks (cards, sections, toggles) the menu uses.
import { useEffect, useState, type ReactNode } from 'react';
import { useSimStore } from '../store/useSimStore';
import { missionActive } from '../mission/mission';
import { bio, resetBio } from '../hud';
import { nav } from '../nav/nav';
import { mmss } from '../nav/drawNav';
import { vr } from './vrEngine';
import { escena, eventoTerreno, limpiarEscenario, quitarEvento, tormentaPolvo, tormentaSolar, type Donde } from '../sim/escenario';

/** Re-render every `ms` (live numbers read from mutable objects). */
export function useTick(ms = 250) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((k) => k + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A big, friendly action: icon, title and what it does. `on` = active toggle. */
export function Card({ icon, title, sub, onClick, on = false, tone = 'cyan', disabled = false }: { icon: string; title: string; sub: string; onClick: () => void; on?: boolean; tone?: 'cyan' | 'amber' | 'red'; disabled?: boolean }) {
  const ring = on ? { cyan: 'border-cyan-300 bg-cyan-400/15', amber: 'border-amber-300 bg-amber-400/15', red: 'border-red-400 bg-red-500/15' }[tone] : 'border-slate-600/80 bg-slate-800/40 hover:bg-slate-700/50 hover:border-slate-400';
  return (
    <button onClick={onClick} disabled={disabled} className={`flex items-start gap-2 text-left rounded-lg border px-2.5 py-2 transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${ring}`}>
      <span className="text-xl leading-none mt-0.5">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-slate-100 leading-tight">{title}</span>
        <span className="block text-[11px] text-slate-400 leading-snug mt-0.5">{sub}</span>
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-600 overflow-hidden">
      {options.map((o) => (
        <button key={String(o.v)} onClick={() => onChange(o.v)} className={`px-2.5 py-1 text-[12px] ${value === o.v ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-400 hover:bg-white/5'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button onClick={onClick} className="flex items-center justify-between gap-3 w-full rounded-lg border border-slate-600/80 bg-slate-800/40 px-2.5 py-1.5 hover:bg-slate-700/50">
      <span className="text-[12.5px] text-slate-200 text-left">
        {label}
        {hint && <span className="text-slate-500"> · {hint}</span>}
      </span>
      <span className={`relative w-9 h-5 rounded-full shrink-0 transition ${on ? 'bg-emerald-400/80' : 'bg-slate-600'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

const HAZ_NAME: Record<string, { icon: string; name: string }> = {
  rocks: { icon: '🪨', name: 'Rocas' },
  hill: { icon: '⛰️', name: 'Loma +12 m' },
  sand: { icon: '〰️', name: 'Arena suelta ×3' },
  cold: { icon: '❄️', name: 'Sombra fría' },
};

// ---------------------------------------------------------------------------
// "Simular" tab: scenario events
// ---------------------------------------------------------------------------
export function EventosTab() {
  useTick(300);
  const hazards = useSimStore((s) => s.hazards).filter((h) => h.id.startsWith('user'));
  const [donde, setDonde] = useState<Donde>(escena.donde);
  const pick = (d: Donde) => {
    escena.donde = d;
    setDonde(d);
  };
  const mision = missionActive();
  const spe = escena.spe;

  return (
    <div className="space-y-4">
      {mision && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-[12px] text-amber-100 leading-snug">
          En modo misión los eventos vienen del guion o del backend (el optimizador replanifica). Volvé a <b>Libre</b> en la pestaña Misión para simular los tuyos.
        </div>
      )}
      {!mision && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-slate-400">Aparecen</span>
            <Segmented value={donde} onChange={pick} options={[{ v: 'ruta', label: 'En la ruta, adelante' }, { v: 'mirada', label: 'Donde mira' }]} />
          </div>

          <Section title="Terreno">
            <div className="grid grid-cols-2 gap-2">
              <Card icon="🪨" title="Desprendimiento" sub="bloques que cortan el paso; la ruta los rodea" onClick={() => eventoTerreno('rocks')} />
              <Card icon="⛰️" title="Loma nueva" sub="+12 m de relieve que el mapa no tenía" onClick={() => eventoTerreno('hill')} />
              <Card icon="〰️" title="Arena suelta" sub="cruzarla cuesta ×3 de O₂" onClick={() => eventoTerreno('sand')} />
              <Card icon="❄️" title="Sombra fría" sub="−100 °C: escarcha en el visor" onClick={() => eventoTerreno('cold')} />
            </div>
          </Section>

          <Section title="Clima espacial">
            <div className="grid grid-cols-2 gap-2">
              <Card icon="🌪️" title={escena.polvo > 0 ? 'Polvo: activa' : 'Tormenta de polvo'} sub={escena.polvo > 0 ? 'tocar para que se disipe' : 'poca visibilidad; JARVIS ve menos'} on={escena.polvo > 0} tone="amber" onClick={() => tormentaPolvo(!(escena.polvo > 0))} />
              {spe?.nivel === 'alerta' ? (
                <Card icon="☢️" title={`SPE: ${mmss(nav.speQuedaS)}`} sub="tocar para escalar a crítico ya" on tone="amber" onClick={() => tormentaSolar('critico')} />
              ) : spe?.nivel === 'critico' ? (
                <Card icon="☢️" title="SPE crítico" sub="tocar para terminar la tormenta" on tone="red" onClick={() => tormentaSolar(null)} />
              ) : (
                <Card icon="☢️" title="Tormenta solar" sub="alerta: protones en 10 min, luego abortar" tone="amber" onClick={() => tormentaSolar('alerta')} />
              )}
            </div>
          </Section>

          <Section title="Astronauta y traje" right={<TimeScale />}>
            <div className="grid grid-cols-2 gap-2">
              <Card icon="🥵" title="Fatiga" sub="VO₂ ×1,3 (como el guion)" on={bio.fatigue > 1} tone="amber" onClick={() => (bio.fatigue = bio.fatigue > 1 ? 1 : 1.3)} />
              <Card icon="💨" title="Fuga de O₂" sub="pierde 2 L/min" on={bio.leakLpm > 0} tone="red" onClick={() => (bio.leakLpm = bio.leakLpm > 0 ? 0 : 2)} />
              <Card icon="🥶" title="Frío extremo" sub="falla de calefacción" on={bio.coldManual} tone="amber" onClick={() => (bio.coldManual = !bio.coldManual)} />
              <Card icon="🫧" title="Recargar O₂" sub="tanque lleno (40 L)" onClick={() => resetBio()} />
            </div>
          </Section>

          <Section
            title={`Activos (${hazards.length + (escena.polvo > 0 ? 1 : 0) + (spe ? 1 : 0)})`}
            right={
              <button onClick={limpiarEscenario} className="text-[12px] px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:border-red-400 hover:text-red-200">
                Quitar todo
              </button>
            }
          >
            {hazards.length === 0 && escena.polvo === 0 && !spe && <div className="text-[12px] text-slate-500">Sin eventos. Tocá una tarjeta: el evento aparece {donde === 'ruta' ? 'sobre la ruta, unos 20 m adelante' : 'donde mira el casco'} y la ruta reacciona.</div>}
            <div className="flex flex-wrap gap-1.5">
              {hazards.map((h) => (
                <span key={h.id} className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800/60 pl-2 pr-1 py-0.5 text-[12px]">
                  {HAZ_NAME[h.kind]?.icon} {HAZ_NAME[h.kind]?.name ?? h.kind} <span className="text-slate-500">{Math.round(Math.hypot(h.x - vr.x, h.z - vr.z))} m</span>
                  <button onClick={() => quitarEvento(h.id)} title="Quitar" className="ml-0.5 w-5 h-5 rounded-full hover:bg-red-500/30 text-slate-300">
                    ×
                  </button>
                </span>
              ))}
              {escena.polvo > 0 && <span className="rounded-full border border-amber-400/50 px-2 py-0.5 text-[12px] text-amber-100">🌪️ polvo</span>}
              {spe && <span className={`rounded-full border px-2 py-0.5 text-[12px] ${spe.nivel === 'critico' ? 'border-red-400/60 text-red-200' : 'border-amber-400/50 text-amber-100'}`}>☢️ SPE {spe.nivel}</span>}
            </div>
          </Section>
        </>
      )}
      <p className="text-[10.5px] text-slate-500 leading-snug">Eventos de escenario, no datos medidos: cambian el terreno y el traje; el mapa de costos, R(p), la ruta A* y el visor reaccionan solos.</p>
    </div>
  );
}

function TimeScale() {
  useTick(500);
  return (
    <div className="flex items-center gap-1" title="Velocidad del reloj del traje (O₂ y la cuenta regresiva SPE)">
      <span className="text-[11px] text-slate-500">reloj</span>
      {[1, 10, 30].map((k) => (
        <button key={k} onClick={() => (bio.timeScale = k)} className={`px-1.5 py-0.5 rounded text-[11px] border ${bio.timeScale === k ? 'border-cyan-300 text-cyan-100' : 'border-slate-600 text-slate-400'}`}>
          ×{k}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Navegación" tab: what the visor shows, in numbers
// ---------------------------------------------------------------------------
export function NavStats() {
  useTick(250);
  const a = nav.atrasoS;
  const sched = !Number.isFinite(a) ? 'empieza al caminar' : Math.abs(a) < 20 ? 'en horario' : a > 0 ? `${mmss(a)} atrasado` : `${mmss(a)} adelantado`;
  const row = (k: string, v: ReactNode) => (
    <div className="flex justify-between gap-3">
      <span className="text-slate-400">{k}</span>
      <span className="font-mono text-slate-100 text-right">{v}</span>
    </div>
  );
  if (!nav.on) return <div className="text-[12.5px] text-slate-400">En el hábitat. Hacé clic en el mapa para marcar un destino; sin destino, la ruta siempre vuelve a la base.</div>;
  return (
    <div className="rounded-lg border border-slate-700/80 bg-slate-800/30 p-2.5 space-y-1 text-[12.5px]">
      <div className="text-amber-200 font-semibold text-[14px]">► {nav.label}</div>
      {row('Por la ruta / en línea recta', `${Math.round(nav.dRuta)} m / ${Math.round(nav.dRecta)} m`)}
      {row('Tiempo óptimo restante', mmss(nav.etaS))}
      {row('Horario del plan', sched)}
      {row('Próximo giro', nav.giro === 0 ? `recto ${Math.round(nav.giroM)} m` : `${nav.giro < 0 ? 'izquierda' : 'derecha'} en ${Math.round(nav.giroM)} m`)}
      {row('O₂ al llegar / para volver', `${Math.max(0, nav.o2Llega).toFixed(1)} L / ${nav.o2Vuelta.toFixed(1)} L`)}
      {row('Desvío de la ruta', `${nav.desvio.toFixed(1)} m`)}
      <div className="text-[10.5px] text-slate-500 leading-snug pt-1">Tiempo óptimo = el ritmo del contrato en cada pendiente (v₀·e^(−0,042|G|)·(1 − 0,28η)). Un desvío o una parada se acumulan como atraso.</div>
    </div>
  );
}
