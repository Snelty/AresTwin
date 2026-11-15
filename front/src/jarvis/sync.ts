// JARVIS / normal view, shared by the laptop and the phone through the sync server ('hud' event).
import type { Socket } from 'socket.io-client';
import { jarvis } from './detector';
import { VPS_SOLO } from '../lib/deployment';

let socket: Socket | null = null;
let seeded = false;

/** Listen for the other device and take the server's value once on connect. */
export function bindJarvisSync(s: Socket) {
  if (VPS_SOLO) return;
  socket = s;
  s.on('hud', (h: { jarvis?: boolean }) => {
    if (typeof h?.jarvis === 'boolean') jarvis.on = h.jarvis;
  });
  s.on('state', (st: { hud?: { jarvis?: boolean } }) => {
    if (seeded || typeof st?.hud?.jarvis !== 'boolean') return;
    seeded = true;
    jarvis.on = st.hud.jarvis;
  });
}

export function setJarvis(on: boolean) {
  jarvis.on = on;
  socket?.emit('hud', { jarvis: on });
}

export const toggleJarvis = () => setJarvis(!jarvis.on);
