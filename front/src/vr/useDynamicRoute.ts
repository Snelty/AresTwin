// Route reactivity for the manual override. Runs on the laptop (the position
// authority). Every 100 ms it projects the astronaut onto the optimal
// polyline:
//   • on the path  → advance the progress mark (the ribbon dims behind you);
//   • off the path → if the deviation exceeds DEVIATION_M, recalculateRoute()
//                    re-runs A* from the current coordinates to the goal and the
//                    ribbon on the ground is redrawn from your feet.
// It also re-plans when the costmap changes (drone scan, new hazards).
import { useEffect, useRef } from 'react';
import { rt } from '../store/simEngine';
import { useSimStore } from '../store/useSimStore';
import { DEVIATION_M, goalRadius, currentGoal, recalculateRoute, vr } from './vrEngine';
import { shelterState } from '../sim/shelter';
import { projectOnPolyline } from './routeGaze';

const CHECK_MS = 100;
const MIN_GAP_MS = 400; // never re-plan more often than this

/** Distance from p to the route polyline and the arc length of the closest point. */
export function projectOnRoute(px: number, pz: number): { dist: number; s: number } {
  return projectOnPolyline(rt.route, px, pz);
}

export function useDynamicRoute(enabled: boolean) {
  const costVersion = useSimStore((s) => s.costVersion);
  const lastRecalc = useRef(0);
  const seenCost = useRef(costVersion);

  // Costmap changed (scan, hazards): the old polyline may no longer be optimal.
  useEffect(() => {
    if (!enabled || !vr.ready || costVersion === seenCost.current) return;
    seenCost.current = costVersion;
    lastRecalc.current = performance.now();
    recalculateRoute('mapa de costos actualizado');
  }, [costVersion, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (!vr.ready) return;
      if (rt.route.n < 2) {
        // No route (standing at home): once the astronaut walks out, draw the way back.
        const g = currentGoal();
        const now = performance.now();
        if (g && !(g.code === 'A' && shelterState.inside) && Math.hypot(g.x - vr.x, g.z - vr.z) > goalRadius(g) && now - lastRecalc.current > MIN_GAP_MS) {
          lastRecalc.current = now;
          recalculateRoute(g.code === 'A' ? 'de vuelta al hábitat' : 'hacia el destino');
        }
        return;
      }
      const { dist, s } = projectOnRoute(vr.x, vr.z);
      vr.lastDeviation = dist;
      if (dist > DEVIATION_M) {
        const now = performance.now();
        if (now - lastRecalc.current < MIN_GAP_MS) return;
        lastRecalc.current = now;
        recalculateRoute(`recalculada (desvío ${dist.toFixed(1)} m)`);
      } else {
        // Never move the progress mark backwards: walking back is a deviation.
        rt.sAstro = Math.max(rt.sAstro, s);
      }
    }, CHECK_MS);
    return () => window.clearInterval(id);
  }, [enabled]);
}
