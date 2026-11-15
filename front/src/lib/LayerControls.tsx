// Laptop: choose the package layer draped over the relief (the phone follows), and the TES value.
import { useEffect, useSyncExternalStore } from 'react';
import { CAPAS, layerState, layerRevision, subscribeLayers, loadTes, setLayer, type CapaId } from './layers';
import { onWorldChange } from '../vr/vrEngine';

export function LayerControls() {
  useSyncExternalStore(subscribeLayers, layerRevision);
  useEffect(() => {
    void loadTes().catch(() => {});
  }, []);
  const choose = (id: CapaId) => {
    try { localStorage.setItem('ares.terrainLayer', id); } catch { /* Storage is optional. */ }
    void setLayer(id);
    onWorldChange?.(); // the phone shows the same layer
  };
  const tes = layerState.tes;
  return (
    <div className="rounded border border-slate-700/80 p-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-slate-400 mr-1">Capa</span>
        {CAPAS.map((c) => (
          <button
            key={c.id}
            onClick={() => choose(c.id)}
            aria-pressed={layerState.actual === c.id}
            className={`px-1.5 py-0.5 rounded border text-[10px] ${layerState.actual === c.id ? 'border-cyan-300 text-cyan-100' : 'border-slate-600 text-slate-400'}`}
          >
            {c.nombre}
          </button>
        ))}
      </div>
      {layerState.nota && <div className="text-[10px] text-slate-400 leading-snug">{layerState.nota}</div>}
      {tes && (
        <div className="text-[10px] text-slate-400 leading-snug">
          Inercia térmica TES: <b className="text-slate-200">{Math.round(tes.valor)}</b> {tes.unidad} en toda la ventana (un píxel de ~3 km, Putzig y Mellon 2007)
        </div>
      )}
    </div>
  );
}
