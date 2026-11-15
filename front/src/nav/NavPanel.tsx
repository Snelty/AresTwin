// The navigation panel on the visor: a hologram in the upper-right corner of
// the view, 0.6 m in front of the eyes (once per eye in the Cardboard). Part of
// the JARVIS view: the normal view hides it.
//
// NavMapDom: the same drawing as a corner card on the laptop (third person).
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { NAV_H, NAV_W, drawNav, mapToWorld } from './drawNav';
import type { ThreeEvent } from '@react-three/fiber';
import { jarvis } from '../jarvis/detector';
import { nav } from './nav';
import { heightAt } from '../lib/terrain';

const D = 0.6;

/** onPick: the laptop picks a destination by clicking the map on the visor (first person). */
export function NavPanel({ stereo = false, onPick }: { stereo?: boolean; onPick?: (x: number, z: number) => void }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const mesh = useRef<THREE.Mesh>(null);
  const p = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = NAV_W;
    c.height = NAV_H;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    return { c, g: c.getContext('2d')!, t, at: 0 };
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: p.t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0.95 }), [p]);
  useEffect(
    () => () => {
      p.t.dispose();
      mat.dispose();
    },
    [p, mat],
  );

  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    m.visible = jarvis.on;
    if (!m.visible) return;
    const t = state.clock.elapsedTime;
    if (t - p.at > 0.1) {
      p.at = t;
      drawNav(p.g, NAV_W, NAV_H);
      p.t.needsUpdate = true;
    }
    const halfH = D * Math.tan(((camera.fov ?? 70) * Math.PI) / 360);
    const halfW = halfH * (camera.aspect / (stereo ? 2 : 1));
    // Upper-right corner, under the heading tape and above the biometrics panel.
    const ph = Math.min(halfH * 0.88, halfW * 0.52 * (NAV_H / NAV_W));
    const pw = ph * (NAV_W / NAV_H);
    m.position.copy(camera.position);
    m.quaternion.copy(camera.quaternion);
    m.translateX(halfW - pw * 0.5 - halfW * 0.04);
    m.translateY(halfH * 0.72 - ph * 0.5);
    m.translateZ(-D);
    m.rotateY(-0.22); // turned toward the eye, like the inside of a curved visor
    m.scale.set(pw, ph, 1);
  }, 0.5);

  return (
    <mesh
      ref={mesh}
      material={mat}
      renderOrder={1000}
      frustumCulled={false}
      visible={false}
      onClick={
        onPick
          ? (e: ThreeEvent<MouseEvent>) => {
              if (!e.uv) return;
              const p = mapToWorld(e.uv.x * NAV_W, (1 - e.uv.y) * NAV_H);
              if (p) {
                e.stopPropagation();
                onPick(p.x, p.z);
              }
            }
          : undefined
      }
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

/** Laptop: the same panel as a card in a corner of the screen; a click on the map picks a destination. */
export function NavMapDom({ className = '', onPick }: { className?: string; onPick?: (x: number, z: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = ref.current;
      if (c) drawNav(c.getContext('2d')!, NAV_W, NAV_H);
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = mapToWorld(((e.clientX - r.left) / r.width) * NAV_W, ((e.clientY - r.top) / r.height) * NAV_H);
    if (p) onPick(p.x, p.z);
  };
  return <canvas ref={ref} width={NAV_W} height={NAV_H} onClick={click} className={`${className} ${onPick ? 'cursor-crosshair' : ''}`} style={{ aspectRatio: `${NAV_W} / ${NAV_H}` }} />;
}

/** The picked destination in the scene: a light column and a ring on the ground (both devices). */
export function DestinoBeacon() {
  const g = useRef<THREE.Group>(null);
  const mats = useMemo(
    () => ({
      col: new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }),
      ring: new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    }),
    [],
  );
  useFrame((state) => {
    const o = g.current;
    if (!o) return;
    o.visible = nav.on && nav.code === 'D';
    if (!o.visible) return;
    o.position.set(nav.gx, heightAt(nav.gx, nav.gz), nav.gz);
    const t = state.clock.elapsedTime;
    mats.col.opacity = 0.25 + 0.12 * Math.sin(t * 3);
    o.children[1].scale.setScalar(1 + 0.15 * Math.sin(t * 3));
  });
  return (
    <group ref={g} visible={false}>
      <mesh material={mats.col} position={[0, 12, 0]} renderOrder={5}>
        <cylinderGeometry args={[0.35, 0.35, 24, 16, 1, true]} />
      </mesh>
      <mesh material={mats.ring} rotation-x={-Math.PI / 2} position={[0, 0.15, 0]} renderOrder={5}>
        <ringGeometry args={[1.6, 2.1, 40]} />
      </mesh>
    </group>
  );
}
