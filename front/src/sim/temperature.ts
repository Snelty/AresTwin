// Scenario temperatures, not sensor readings or the TES thermal-inertia TIFF.
export interface TemperatureSnapshot {
  cold: boolean;
  thermal: boolean;
  baselineC: number;
  temperatureC: number;
}
export const temperature = { cold: false, thermal: false, baselineC: -20, temperatureC: -20 };
export const THERMAL_MIN_C = -120;
export const THERMAL_MAX_C = 40;
export const THERMAL_COLORS = ['#1f0580', '#0066ff', '#00e68c', '#ff4d08', '#fff240'];

/** Laptop owns the clock and the cold switch; clients receive the same degrees C. */
export function stepTemperature(dt: number, baselineC: number, cold: boolean) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(baselineC)) return;
  temperature.baselineC = baselineC;
  temperature.cold = cold;
  const target = cold ? Math.min(-100, baselineC - 60) : baselineC;
  temperature.temperatureC += (target - temperature.temperatureC) * (1 - Math.exp(-Math.min(dt, 1) / (cold ? 2 : 3)));
}
export const coolingAmount = () => Math.min(1, Math.max(0, (temperature.baselineC - temperature.temperatureC) / 60));
export const temperatureSnapshot = (): TemperatureSnapshot => ({ ...temperature });
export function applyTemperature(value: TemperatureSnapshot) {
  if (typeof value?.cold !== 'boolean' || typeof value?.thermal !== 'boolean'
    || !Number.isFinite(value.baselineC) || !Number.isFinite(value.temperatureC)) return;
  Object.assign(temperature, value);
}
