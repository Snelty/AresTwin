// Boulders of the site and the loose stones around the crew.
//
// Shapes: an icosphere pushed out with 3D noise and then cut by a few random
// planes, which gives the flat faces and worn edges of fractured rock; the
// bottom is flattened and buried. Surface: baked stone texture projected from
// three sides (no stretching), airfall dust on the faces that look up and in
// the pits, soil banked against the foot, and a darker contact line so the
// rock sits IN the ground instead of on it.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LITOS, litologiaDe } from '../../jarvis/lithology';
import { hash3, noise3, makeRockGeometry, rockVariants, ROCK_VARIANTS as VARIANTS, BIG_ROCK as BIG, composeRockMatrix, type RockLike } from '../../lib/rockShape';
import { BASE_A, HALF, ROCKS, heightAt, normalAt, sandAt } from '../../lib/terrain';
import { mulberry32 } from '../../lib/noise';
import { rt } from '../../store/simEngine';
import { GROUND_COLORS, detailTextures } from '../../render/groundMaterial';
import { addMarsFog } from '../../render/marsFog';
import { Q, tier } from '../../render/quality';
import type { Caster } from '../../render/shadeBake';
export { makeRockGeometry, rockVariants, type RockLike } from '../../lib/rockShape';

export interface RockMaterialOptions {
  /** Loose stones: smaller texture scale and a shrink-to-nothing ring at the edge of the populated area. */
  clutter?: boolean;
}

export const clutterUniforms = { uClutterFocus: { value: new THREE.Vector3() }, uClutterRadius: { value: Q.clutterRadius } };

export function makeRockMaterial({ clutter = false }: RockMaterialOptions = {}) {
  const tex = detailTextures();
  const normalMaps = tier !== 'low';
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.93, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    addMarsFog(shader);
    Object.assign(shader.uniforms, { uStoneN: { value: tex.stoneN }, uStoneA: { value: tex.stoneA } }, clutter ? clutterUniforms : {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRockPos; varying float vRockY;\n${clutter ? 'uniform vec3 uClutterFocus; uniform float uClutterRadius;' : ''}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vRockY = position.y;
${
  clutter
    ? `#ifdef USE_INSTANCING
  float dEdge = distance(instanceMatrix[3].xz, uClutterFocus.xz);
  transformed *= 1.0 - smoothstep(uClutterRadius * 0.70, uClutterRadius * 0.97, dEdge);
#endif`
    : ''
}`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
  vRockPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRockPos; varying float vRockY;
uniform sampler2D uStoneN; uniform sampler2D uStoneA;
${GROUND_COLORS}
vec3 rockPerturb = vec3(0.0); float rockAo = 1.0;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 nW = normalize(inverseTransformDirection(normalize(vNormal), viewMatrix));
  vec3 bw = pow(abs(nW), vec3(4.0));
  bw /= bw.x + bw.y + bw.z;
  float S = ${clutter ? '2.6' : '0.95'};
  vec2 uvx = vRockPos.zy * S; vec2 uvy = vRockPos.xz * S; vec2 uvz = vRockPos.xy * S;
  vec3 a = texture2D(uStoneA, uvx).rgb * bw.x + texture2D(uStoneA, uvy).rgb * bw.y + texture2D(uStoneA, uvz).rgb * bw.z;
${
  normalMaps
    ? `  // The same texture four times larger: lumps and tonal bands you can see from across the site.
  vec3 big = texture2D(uStoneN, uvx * 0.23).rgb * bw.x + texture2D(uStoneN, uvy * 0.23).rgb * bw.y + texture2D(uStoneN, uvz * 0.23).rgb * bw.z;
  diffuseColor.rgb *= (0.42 + 0.98 * a.r) * (0.78 + 0.5 * big.z);`
    : `  diffuseColor.rgb *= 0.42 + 0.98 * a.r;`
}
  // Airfall dust settles on what faces the sky and in the pits; wind keeps the steep faces clean.
  float dust = smoothstep(0.30, 0.86, nW.y + (a.b - 0.25) * 0.55) * ${clutter ? '0.62' : '0.78'};
  // Soil banked against the foot of the rock.
  float foot = smoothstep(${clutter ? '-0.05' : '0.02'}, -0.24, vRockY);
  dust = max(dust, foot * 0.92);
  diffuseColor.rgb = mix(diffuseColor.rgb, C_DUST * (0.62 + 0.62 * a.r), dust);
  rockAo = a.g * mix(0.50, 1.0, smoothstep(-0.30, 0.10, vRockY));
${
  normalMaps
    ? `  float camD = distance(cameraPosition, vRockPos);
  float nw = (1.0 - smoothstep(18.0, 60.0, camD)) * 1.1;
  vec2 tx = (texture2D(uStoneN, uvx).xy - 0.5) * 2.0; vec2 ty = (texture2D(uStoneN, uvy).xy - 0.5) * 2.0; vec2 tz = (texture2D(uStoneN, uvz).xy - 0.5) * 2.0;
  rockPerturb = (vec3(0.0, tx.y, tx.x) * bw.x + vec3(ty.x, 0.0, ty.y) * bw.y + vec3(tz.x, tz.y, 0.0) * bw.z) * nw;
  vec2 bx = (texture2D(uStoneN, uvx * 0.23).xy - 0.5) * 2.0; vec2 by = (texture2D(uStoneN, uvy * 0.23).xy - 0.5) * 2.0; vec2 bz = (texture2D(uStoneN, uvz * 0.23).xy - 0.5) * 2.0;
  rockPerturb += (vec3(0.0, bx.y, bx.x) * bw.x + vec3(by.x, 0.0, by.y) * bw.y + vec3(bz.x, bz.y, 0.0) * bw.z) * 0.9 * (1.0 - smoothstep(60.0, 160.0, camD));`
    : ''
}
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize(normal + (viewMatrix * vec4(rockPerturb, 0.0)).xyz);`,
      )
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= rockAo; reflectedLight.directDiffuse *= mix(1.0, rockAo, 0.35);');
  };
  mat.customProgramCacheKey = () => `mars-rock-${clutter}-${normalMaps}`;
  return mat;
}

let sharedRockMat: THREE.MeshStandardMaterial | null = null;
export const rockMaterial = () => (sharedRockMat ??= makeRockMaterial());

// Tints: dark basalt blocks, brown sandstone, light mudstone.
const TINTS = [
  [0.27, 0.215, 0.18],
  [0.34, 0.255, 0.185],
  [0.215, 0.18, 0.16],
  [0.4, 0.3, 0.21],
  [0.3, 0.23, 0.17],
];

/** Instanced boulders: `rocks` are world positions and sizes (the same ones the planner avoids). */
export function RockInstances({ rocks, version }: { rocks: RockLike[]; version: number | string }) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const geos = rockVariants();
  const mat = rockMaterial();
  const groups = useMemo(() => {
    const out: RockLike[][] = Array.from({ length: VARIANTS * 2 }, () => []);
    rocks.forEach((r, i) => out[(i % VARIANTS) * 2 + (r.s >= BIG ? 0 : 1)].push(r));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rocks, version]);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    groups.forEach((list, gi) => {
      const mesh = refs.current[gi];
      if (!mesh) return;
      list.forEach((r, i) => {
        const k = hash3(Math.round(r.x * 10), 7, Math.round(r.z * 10));
        mesh.setMatrixAt(i, composeRockMatrix(r, m));
        // Colour of its lithology (JARVIS names it from the same function), with a little variation.
        const t = r.s >= 0.25 ? LITOS[litologiaDe(r.x, r.z, r.s)].tint : TINTS[Math.floor(k * TINTS.length) % TINTS.length];
        const v = 0.88 + 0.24 * hash3(Math.round(r.z * 10), 11, Math.round(r.x * 10));
        mesh.setColorAt(i, c.setRGB(t[0] * v, t[1] * v, t[2] * v));
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [groups]);

  return (
    <>
      {groups.map((list, gi) => (
        <instancedMesh
          key={`${gi}-${list.length}`}
          ref={(mm) => (refs.current[gi] = mm)}
          args={[gi % 2 === 0 ? geos[gi >> 1].hi : geos[gi >> 1].lo, mat, Math.max(1, list.length)]}
          castShadow
          receiveShadow
        />
      ))}
    </>
  );
}

/** What the boulders shadow on the ground, for the baked light of the far field. */
export function rockCasters(rocks: RockLike[] = ROCKS): Caster[] {
  return rocks.map((r) => ({ x: r.x, z: r.z, r: r.s * 0.92, h: r.s * (r.sy ?? 0.8) }));
}

export function Rocks({ version }: { version: number }) {
  return <RockInstances rocks={ROCKS} version={version} />;
}

// ---------------------------------------------------------------------------
// Loose stones: thousands of small rocks kept in a disc around the crew. The
// layout is a pure function of the position (hashed grid), so both devices see
// the same stones and they are still there when you walk back.
// ---------------------------------------------------------------------------
const CELL = 1.3;
const PER_CELL = 5;

export function Clutter({ version }: { version: number }) {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  // Angular fragments and flat slabs, like the float rocks of Gale (not river pebbles).
  const geos = useMemo(() => [makeRockGeometry(42, tier === 'low' ? 1 : 2, 0), makeRockGeometry(43, tier === 'low' ? 1 : 2, 1)], []);
  const mat = useMemo(() => makeRockMaterial({ clutter: true }), []);
  const built = useRef({ x: 1e9, z: 1e9, version: -1 });
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color(), n: { x: 0, y: 1, z: 0 } }), []);

  useFrame(() => {
    const [imA, imB] = meshes.current;
    if (!imA || !imB) return;
    const fx = rt.astro.x;
    const fz = rt.astro.z;
    clutterUniforms.uClutterFocus.value.set(fx, 0, fz);
    if (Math.hypot(fx - built.current.x, fz - built.current.z) < CELL * 1.5 && built.current.version === version) return;
    built.current = { x: fx, z: fz, version };

    const R = Q.clutterRadius;
    const { m, q, e, p, s, c, n } = tmp;
    const i0 = Math.floor((fx - R) / CELL), i1 = Math.floor((fx + R) / CELL);
    const j0 = Math.floor((fz - R) / CELL), j1 = Math.floor((fz + R) / CELL);
    const counts = [0, 0];
    const max = Math.floor(Q.clutter / 2);
    for (let cj = j0; cj <= j1; cj++)
      for (let ci = i0; ci <= i1; ci++) {
        const cx = (ci + 0.5) * CELL;
        const cz = (cj + 0.5) * CELL;
        if (Math.hypot(cx - fx, cz - fz) > R + CELL) continue;
        for (let k = 0; k < PER_CELL; k++) {
          const which = hash3(cj, k + 100, ci) < 0.62 ? 0 : 1;
          const im = which === 0 ? imA : imB;
          const count = counts[which];
          if (count >= max) continue;
          const h1 = hash3(ci, k * 3 + 1, cj);
          const x = (ci + h1) * CELL;
          const z = (cj + hash3(ci, k * 3 + 2, cj)) * CELL;
          if (Math.abs(x) > HALF - 1.5 || Math.abs(z) > HALF - 1.5) continue;
          // Fewer stones on loose sand and on the swept habitat pad; clusters elsewhere.
          const sand = sandAt(x, z);
          const patch = noise3(x * 0.09, 3.7, z * 0.09);
          const density = (1 - 0.9 * sand) * (0.25 + 1.5 * patch * patch);
          if (hash3(ci, k * 3 + 3, cj) > density) continue;
          if (Math.hypot(x - (BASE_A.x - 7), z - (BASE_A.z - 7)) < 9.6) continue;
          // Power law of sizes: most are pebbles, a few are fist- to head-sized.
          const u = hash3(cj, k * 5 + 4, ci);
          const size = 0.022 + 0.2 * Math.pow(u, 3.4);
          normalAt(x, z, n, 0.6);
          e.set(hash3(ci, k + 20, cj) * 6.28, hash3(cj, k + 30, ci) * 6.28, (hash3(ci, k + 40, cj) - 0.5) * 0.8);
          q.setFromEuler(e);
          const flat = 0.55 + 0.5 * hash3(cj, k + 50, ci);
          p.set(x, heightAt(x, z) + size * flat * (0.05 + 0.3 * hash3(ci, k + 60, cj)), z);
          s.set(size, size * flat, size * (0.7 + 0.5 * hash3(cj, k + 70, ci)));
          im.setMatrixAt(count, m.compose(p, q, s));
          const t = TINTS[Math.floor(hash3(ci, k + 80, cj) * TINTS.length) % TINTS.length];
          const v = 0.8 + 0.45 * hash3(cj, k + 90, ci);
          im.setColorAt(count, c.setRGB(t[0] * v, t[1] * v, t[2] * v));
          counts[which]++;
        }
      }
    [imA, imB].forEach((im, i) => {
      im.count = counts[i];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  });

  return (
    <>
      {geos.map((geo, i) => (
        <instancedMesh key={i} ref={(m) => (meshes.current[i] = m)} args={[geo, mat, Math.max(1, Math.floor(Q.clutter / 2))]} castShadow={Q.clutterShadows} receiveShadow frustumCulled={false} />
      ))}
    </>
  );
}
