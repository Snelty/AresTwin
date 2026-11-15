/** Device detection is independent of viewport resizing: a narrow PC stays a PC. */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export const MOBILE_VR = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('role') === 'vr' && isMobileDevice();
