import { CLASE_NOMBRE } from './catalog';
import type { Detection } from './detector';

/** Shared wording for scene labels and the readable phone overlay. */
export function objectDescription(det: Detection) {
  const o = det.o;
  const sized = ['roca', 'bloque', 'meteorito', 'veta', 'concrecion'].includes(o.clase);
  const size = sized ? ` · ${(det.rMedido * 2).toFixed(1).replace('.', ',')} m` : '';
  const name = det.ident
    ? `${det.ident.nombre}${!det.ident.generico && det.ident.conf < 0.6 ? '?' : ''}`
    : det.idAnomalia?.nombre ?? CLASE_NOMBRE[o.clase];
  const title = o.clase === 'sitio' ? `${o.id} · ${o.nota ?? 'sitio'}`
    : o.clase === 'peligro' ? `PELIGRO ${o.id}` : `${name}${size}`;
  const status = o.clase === 'peligro' ? 'PELIGRO'
    : det.m.estado === 'catalogado' ? 'Catalogado' : det.m.estado === 'similar' ? 'Similar' : 'Nuevo';
  return { title, detail: `${Math.round(det.d)} m · ${status}`, document: det.m.interes >= 0.5 };
}
