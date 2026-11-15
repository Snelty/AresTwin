export type VRCommand = { type: 'solar-storm' };
export type VRCommandResult = { ok: true } | { ok: false; reason: 'no-host' | 'mission-mode' | 'timeout' | 'invalid-command' };

/** Physical 1 below F1, without triggering while typing or on key auto-repeat. */
export function isSolarStormShortcut(event: KeyboardEvent): boolean {
  if (event.code !== 'Digit1' || event.repeat || event.isComposing || event.defaultPrevented
    || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
  const target = event.target as HTMLElement | null;
  return !target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}
