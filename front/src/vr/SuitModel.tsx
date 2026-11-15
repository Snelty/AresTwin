// The astronaut: a procedurally built EVA suit (vr/suit/build.ts) animated by
// a small physics-aware rig (vr/suit/rig.ts). It is drawn on both devices:
// in third person you see the whole figure; in first person the helmet is
// hidden, so looking down shows your own chest unit, arms, legs and boots —
// and your shadow on the ground, helmet included.
//
// ► Modelo externo (bandera, experimental): ?astronauta=render, o el botón de
//   la pestaña Entorno, carga public/models/astronauta-render.glb (exportado de
//   render/astronauta/Spacesuit_1.blend) en la vista en tercera persona. Se
//   escala a la altura del traje, con los pies en el suelo, y como no tiene
//   esqueleto sólo se balancea al caminar. En primera persona (y en el celular)
//   sigue el traje procedural, que mueve brazos y piernas. Si el archivo no
//   está, también queda el procedural.
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { rt } from '../store/simEngine';
import { SuitRig } from './suit/rig';
import { SuitFx, type SuitFxHandle } from './suit/SuitFx';
import { suitState } from './suit/state';

export const SUIT_GLB_URL = '/models/astronauta-render.glb';
/** Height the external model is scaled to (the procedural suit, helmet included), m. */
const SUIT_HEIGHT = 1.88;

/** Flag: which astronaut the third-person view draws. Initial value from ?astronauta=render or the last choice. */
export const suitChoice = {
  modelo: ((): 'procedural' | 'render' => {
    const q = new URLSearchParams(location.search).get('astronauta');
    if (q === 'render' || q === 'procedural') return q;
    return localStorage.getItem('ares.astronauta') === 'render' ? 'render' : 'procedural';
  })(),
};
export function setSuitChoice(m: 'procedural' | 'render') {
  suitChoice.modelo = m;
  localStorage.setItem('ares.astronauta', m);
}

function GlbSuit() {
  const { scene } = useGLTF(SUIT_GLB_URL);
  const root = useRef<THREE.Group>(null);
  // Fit whatever came out of Blender: scale to the suit's height, feet at y = 0, centred.
  const fitted = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const k = size.y > 1e-6 ? SUIT_HEIGHT / size.y : 1;
    const c = box.getCenter(new THREE.Vector3());
    const g = new THREE.Group();
    scene.position.set(-c.x, -box.min.y, -c.z);
    g.add(scene);
    g.scale.setScalar(k);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    return g;
  }, [scene]);
  const gait = useRef({ phase: 0 });
  useFrame((_, dtRaw) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(dtRaw, 0.05);
    // No skeleton: a stride bob and sway at the walking cadence (≈ 1.8 steps/s at 1 m/s).
    const v = Math.min(2.5, rt.astro.speed);
    const moving = v > 0.15;
    if (moving) gait.current.phase += dt * Math.PI * (1.2 + 0.9 * v);
    const ph = gait.current.phase;
    const amp = moving ? Math.min(1, v) : 0;
    g.position.set(rt.astro.x, rt.astro.y + Math.abs(Math.sin(ph)) * 0.035 * amp, rt.astro.z);
    g.rotation.set(0.05 * amp, Math.PI - rt.astro.heading, Math.sin(ph) * 0.035 * amp, 'YXZ');
  });
  return (
    <group ref={root}>
      <primitive object={fitted} />
    </group>
  );
}

class GlbBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Is there a real glTF at SUIT_GLB_URL? (dev servers answer HTML for missing files) */
function useHasGlb(wanted: boolean) {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!wanted) return;
    fetch(SUIT_GLB_URL, { method: 'HEAD' })
      .then((r) => {
        const type = r.headers.get('content-type') ?? '';
        setHas(r.ok && !type.includes('text/html'));
      })
      .catch(() => setHas(false));
  }, [wanted]);
  return has;
}

/**
 * firstPerson: the camera is inside the helmet (helmet hidden, shadow kept).
 * The rig runs before the cameras are placed (priority −1), after the body has moved (priority −2).
 */
export function SuitModel({ firstPerson, modelo = 'procedural' }: { firstPerson: boolean; modelo?: 'procedural' | 'render' }) {
  const rig = useMemo(() => new SuitRig(), []);
  const fx = useRef<SuitFxHandle>(null);
  const hasGlb = useHasGlb(modelo === 'render');
  // The procedural rig keeps running underneath: eyes, the drone dock and footsteps come from it.
  const useGlb = modelo === 'render' && hasGlb && !firstPerson;

  useEffect(() => {
    rig.onStep = (e) => fx.current?.step(e);
    return () => {
      rig.onStep = null;
      suitState.dockValid = false;
    };
  }, [rig]);

  useFrame((_, dt) => {
    rig.update(dt, { x: rt.astro.x, z: rt.astro.z, bodyYaw: rt.astro.heading, headYaw: suitState.lookYaw, headPitch: suitState.lookPitch, firstPerson });
    suitState.dockPos.copy(rig.dockPos);
    suitState.dockQuat.copy(rig.dockQuat);
    suitState.dockValid = true;
    suitState.neck.copy(rig.neck);
    suitState.speed = rig.speed;
    suitState.debug = rig.debug;
    rig.root.visible = !useGlb;
  }, -1);

  return (
    <>
      <primitive object={rig.root} />
      <SuitFx ref={fx} />
      {useGlb && (
        <GlbBoundary fallback={null}>
          <Suspense fallback={null}>
            <GlbSuit />
          </Suspense>
        </GlbBoundary>
      )}
    </>
  );
}
