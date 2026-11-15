import { coolingAmount, temperature } from '../sim/temperature';

export const thermalUniforms = {
  uThermalOn: { value: 0 }, uScenarioTempC: { value: -20 }, uScenarioCooling: { value: 0 },
};
export function updateThermalUniforms() {
  thermalUniforms.uThermalOn.value = temperature.thermal ? 1 : 0;
  thermalUniforms.uScenarioTempC.value = temperature.temperatureC;
  thermalUniforms.uScenarioCooling.value = coolingAmount();
}
export const THERMAL_GLSL = /* glsl */ `
uniform float uThermalOn; uniform float uScenarioTempC; uniform float uScenarioCooling;
// Fixed scale: blue/purple at -120 C, green in the middle, red/yellow at +40 C.
vec3 scenarioHeatColor(float degreesC) {
  float t = clamp((degreesC + 120.0) / 160.0, 0.0, 1.0);
  if (t < 0.25) return mix(vec3(0.12, 0.02, 0.50), vec3(0.0, 0.40, 1.0), t * 4.0);
  if (t < 0.50) return mix(vec3(0.0, 0.40, 1.0), vec3(0.0, 0.90, 0.55), (t - 0.25) * 4.0);
  if (t < 0.75) return mix(vec3(0.0, 0.90, 0.55), vec3(1.0, 0.30, 0.03), (t - 0.50) * 4.0);
  return mix(vec3(1.0, 0.30, 0.03), vec3(1.0, 0.95, 0.25), (t - 0.75) * 4.0);
}
`;
