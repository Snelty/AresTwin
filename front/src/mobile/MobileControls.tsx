import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { joystickVector, mobileStick, resetMobileStick } from './joystick';
import { bio } from '../hud/bio';
import { jarvis } from '../jarvis/detector';
import { objectDescription } from '../jarvis/objectDescription';
import { toggleJarvis } from '../jarvis/sync';
import { drawNav, mapToWorld, NAV_W } from '../nav/drawNav';
import { nav } from '../nav/nav';
import { setDestino } from '../vr/vrEngine';
import { escena, executeVRCommand } from '../sim/escenario';
import { shelterState, HABITAT_TEMPERATURE_C } from '../sim/shelter';
import { temperature } from '../sim/temperature';
import './mobileGame.css';

export function MobileControls() {
  const pointer = useRef<number | null>(null), map = useRef<HTMLCanvasElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [, render] = useState(0);
  const reset = () => { pointer.current = null; resetMobileStick(); setKnob({ x: 0, y: 0 }); };
  useEffect(() => {
    const timer = window.setInterval(() => {
      const canvas = map.current;
      if (canvas) drawNav(canvas.getContext('2d')!, NAV_W, NAV_W, true, true);
      render(n => n + 1);
    }, 200);
    const hidden = () => { if (document.hidden) reset(); };
    window.addEventListener('blur', reset); document.addEventListener('visibilitychange', hidden);
    return () => { clearInterval(timer); window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', hidden); resetMobileStick(); };
  }, []);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointer.current) return;
    e.preventDefault(); e.stopPropagation();
    const box = e.currentTarget.getBoundingClientRect();
    const next = joystickVector(e.clientX - box.left - box.width / 2, e.clientY - box.top - box.height / 2, box.width * 0.34);
    mobileStick.fwd = next.fwd; mobileStick.strafe = next.strafe; setKnob({ x: next.x, y: next.y });
  };
  const release = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.pointerId !== pointer.current) return;
    reset();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const focused = jarvis.on ? jarvis.foco : null;
  const description = focused ? objectDescription(focused) : null;
  return <div className="mobile-controls" data-game-ui>
    <div className="mobile-vitals">
      <div><span>O₂</span><strong>{bio.O2.toFixed(1)} <small>L</small></strong><span>PULSO</span><strong>{Math.round(bio.FC)} <small>lpm</small></strong></div>
      <p>{shelterState.inside ? `Refugiado · ${HABITAT_TEMPERATURE_C} °C` : `${Math.round(temperature.temperatureC)} °C`}</p>
      {nav.on && <p className="mobile-destination">{nav.label} · {Math.round(nav.dRuta)} m</p>}
    </div>
    <canvas ref={map} width={NAV_W} height={NAV_W} className="mobile-map" aria-label="Mapa: tocá un punto para marcar el destino" onClick={e => {
      const box = e.currentTarget.getBoundingClientRect();
      const p = mapToWorld((e.clientX - box.left) / box.width * NAV_W, (e.clientY - box.top) / box.height * NAV_W + NAV_W * 0.06);
      if (p) setDestino(p.x, p.z);
    }} />
    {description && <section className="mobile-object-info" aria-label="Objeto enfocado" data-kind={focused!.o.clase === 'peligro' ? 'peligro' : focused!.m.estado}>
      <h2>{description.title}</h2>
      <p>{description.detail}</p>
      {description.document && <p className="mobile-object-interest">★ Documentar</p>}
    </section>}
    <div className="mobile-joystick" role="group" aria-label="Joystick de movimiento" onContextMenu={e => e.preventDefault()}
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (pointer.current !== null) return; pointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
      <span className="mobile-joystick-cross">＋</span>
      <span className="mobile-joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
    <div className="mobile-actions">
      <button aria-label="Activar o desactivar JARVIS" aria-pressed={jarvis.on} title="JARVIS" onClick={toggleJarvis}>◇</button>
      <button aria-label="Activar o desactivar tormenta solar" aria-pressed={!!escena.spe} title="Tormenta solar" onClick={() => executeVRCommand({ type: 'solar-storm' })}>☀</button>
      <button aria-label="Activar o desactivar frío" aria-pressed={bio.coldManual} title="Frío" onClick={() => executeVRCommand({ type: 'cold' })}>❄</button>
      <button aria-label="Activar o desactivar vista térmica" aria-pressed={temperature.thermal} title="Vista térmica" onClick={() => executeVRCommand({ type: 'thermal-view' })}>♨</button>
    </div>
    <span className="mobile-look-hint">Arrastrá para mirar</span>
  </div>;
}
