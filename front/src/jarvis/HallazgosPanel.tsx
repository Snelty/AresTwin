// Laptop: the findings log of JARVIS (new objects worth documenting), newest first.
import { useEffect, useState } from 'react';
import { CLASE_NOMBRE, field } from './catalog';
import { jarvis } from './detector';
import { ESCENARIO, bd, reiniciarEva } from './bd';

export function HallazgosPanel() {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((k) => k + 1), 500);
    return () => window.clearInterval(id);
  }, []);
  const reiniciar = async () => {
    if (!window.confirm('¿Borrar de MySQL lo que registró la EVA y todas las observaciones? El relevamiento orbital se conserva.')) return;
    await reiniciarEva().catch((e) => window.alert((e as Error).message));
    force((k) => k + 1);
  };
  return (
    <div className="space-y-3">
    <div className="rounded-lg border border-slate-700/80 bg-slate-800/30 p-2.5 space-y-1 text-[12px]">
      <div className="flex items-center justify-between">
        <span className={bd.estado === 'conectado' ? 'text-emerald-300' : bd.estado === 'conectando' ? 'text-slate-300' : 'text-amber-300'}>
          ● Base de datos {bd.estado === 'conectado' ? 'MySQL conectada' : bd.estado === 'conectando' ? 'conectando…' : 'no disponible'}
        </span>
        <a href="http://localhost/phpmyadmin/index.php?route=/database/structure&db=ares_twin" target="_blank" rel="noreferrer" className="text-cyan-300 underline">
          phpMyAdmin
        </a>
      </div>
      <div className="font-mono text-slate-300">
        ares_twin · {ESCENARIO} · orbital {bd.orbital} · EVA {bd.eva} · observaciones {bd.obs}
      </div>
      {bd.msg && <div className="text-[11px] text-slate-500 leading-snug">{bd.msg}</div>}
      <div className="text-[11px] text-slate-500 leading-snug">Lo nuevo que el traje mapea de cerca (&lt; 15 m) se registra como fuente «eva» y en la próxima pasada sale como catalogado. Cada identificación queda en «observaciones».</div>
      {bd.estado === 'conectado' && (
        <button onClick={reiniciar} className="text-[11.5px] px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:border-red-400 hover:text-red-200">
          Reiniciar lo registrado por la EVA
        </button>
      )}
    </div>
    <div className="rounded border border-fuchsia-500/30 p-2 space-y-1">
      <div className="flex justify-between">
        <span className="text-fuchsia-200">★ Hallazgos JARVIS ({jarvis.hallazgos.length})</span>
        <span className="text-slate-500">catálogo: {field.nDb}</span>
      </div>
      {jarvis.hallazgos.length === 0 && <div className="text-[10px] text-slate-500">Todavía nada nuevo a la vista. Los marcos magenta son objetos que no están en la BD.</div>}
      {jarvis.hallazgos.slice(0, 6).map((h) => (
        <div key={h.id} className="text-[10px] leading-snug">
          <b className="text-amber-200">{CLASE_NOMBRE[h.clase]}</b> <span className="text-slate-400">({h.id})</span> · {h.motivo}
          <div className="text-slate-500 font-mono">
            x {h.x.toFixed(1)} · y {h.y.toFixed(1)} m · {h.cuando} · interés {Math.round(h.interes * 100)} %
          </div>
        </div>
      ))}
      <div className="text-[9px] text-slate-500 leading-snug">Detección simulada: el sensor reporta lo que la escena tiene en el campo visual y lo compara con el catálogo (no es una red neuronal sobre la cámara). La litología de cada roca es un escenario basado en la estratigrafía de Mount Sharp: no son datos medidos.</div>
    </div>
    </div>
  );
}
