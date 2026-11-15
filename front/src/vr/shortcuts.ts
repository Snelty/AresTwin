export type VRCommand = { type: 'solar-storm' | 'cold' | 'thermal-view' };
export type VRCommandResult = { ok: true } | { ok: false; reason: 'no-host' | 'mission-mode' | 'timeout' | 'invalid-command' };

/** Physical number row below F1: ignore typing, modifiers and auto-repeat. */
export function vrCommandForKey(event: KeyboardEvent): VRCommand | null {
  if (event.repeat || event.isComposing || event.defaultPrevented
    || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
  const target = event.target as HTMLElement | null;
  if (target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return null;
  if (event.code === 'Digit1') return { type: 'solar-storm' };
  if (event.code === 'Digit2') return { type: 'cold' };
  if (event.code === 'Digit3') return { type: 'thermal-view' };
  return null;
}
