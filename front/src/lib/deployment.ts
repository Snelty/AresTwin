// Enabled only by build:vps. Local dev and ordinary builds keep the paired PC/headset behavior.
export const VPS_SOLO = import.meta.env?.VITE_VPS_SOLO === '1';
