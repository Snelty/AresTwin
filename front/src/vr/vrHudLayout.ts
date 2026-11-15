/** Headset-only layout in eye-plane metres. PC uses its own existing panels. */
export function vrHudLayout(halfW: number, halfH: number) {
  const vitalWidth = Math.min(halfW * 0.46, halfH * 0.60);
  const vitalHeight = vitalWidth * 132 / 360;
  const analysisWidth = Math.min(halfW * 0.70, halfH * 0.98);
  const analysisHeight = analysisWidth * 160 / 520;
  // Keep the readouts inside the comfortable field of view of a Cardboard lens.
  const bottom = -halfH * 0.60;
  const mapSize = Math.min(halfH * 0.56, halfW * 0.60);
  return {
    oxygen: { x: -halfW * 0.60, y: bottom + vitalHeight / 2, w: vitalWidth, h: vitalHeight },
    analysis: { x: 0, y: bottom + analysisHeight / 2, w: analysisWidth, h: analysisHeight },
    pulse: { x: halfW * 0.60, y: bottom + vitalHeight / 2, w: vitalWidth, h: vitalHeight },
    map: { x: halfW * 0.77 - mapSize / 2, y: halfH * 0.60 - mapSize / 2, w: mapSize, h: mapSize },
    latency: { x: 0, y: -halfH * 0.82, w: Math.min(halfW * 0.32, halfH * 0.40), h: Math.min(halfW * 0.32, halfH * 0.40) / 4 },
    climate: { x: 0, y: -halfH * 0.82, w: Math.min(halfW * 0.65, halfH * 0.84), h: Math.min(halfW * 0.65, halfH * 0.84) * 160 / 512 },
  };
}
