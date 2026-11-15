export const mobileStick = { fwd: 0, strafe: 0 };

/** Radial dead zone and clamped analog movement, independent of CSS size. */
export function joystickVector(dx: number, dy: number, radius: number) {
  const distance = Math.hypot(dx, dy);
  if (radius <= 0 || distance < radius * 0.14) return { fwd: 0, strafe: 0, x: 0, y: 0 };
  const strength = Math.min(1, (distance / radius - 0.14) / 0.86);
  const knob = Math.min(radius, distance);
  return { fwd: -dy / distance * strength, strafe: dx / distance * strength, x: dx / distance * knob, y: dy / distance * knob };
}

export function resetMobileStick() { mobileStick.fwd = 0; mobileStick.strafe = 0; }
