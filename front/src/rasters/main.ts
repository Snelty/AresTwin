import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';

interface Raster {
  id: string; title: string; source: string; rows: number; columns: number;
  min: number; max: number; unit: string; description: string; image: string;
  colors: string[]; reference: string | null; dem?: string;
  meshRows?: number; meshColumns?: number; width?: number; depth?: number; cell?: number;
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const number = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 2 });
const base = `${import.meta.env.BASE_URL}rasters/`;
let selected: Raster;
let sequence = 0;
let mode: '2d' | '3d' = '2d';
let cleanup: (() => void) | undefined;

function status(message: string) { $('status').textContent = message; $('status').hidden = !message; }
function viewMode(next: '2d' | '3d') {
  mode = next;
  $('raster').hidden = next === '3d'; $('scene').hidden = next === '2d';
  $('exaggeration').hidden = next === '2d';
  $('flat').setAttribute('aria-pressed', String(next === '2d'));
  $('relief').setAttribute('aria-pressed', String(next === '3d'));
  $('hint').textContent = next === '3d' ? 'Arrastra para orbitar · rueda para acercar · botón derecho para desplazar' : 'Norte arriba · colores según el valor del píxel';
}

async function show3d() {
  if (!selected.dem) return;
  const item = selected, mine = ++sequence;
  cleanup?.(); cleanup = undefined;
  viewMode('3d'); status('Construyendo relieve…');
  let geometry: THREE.PlaneGeometry | undefined;
  let material: THREE.MeshStandardMaterial | undefined;
  let texture: THREE.Texture | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  let controls: OrbitControls | undefined;
  let resize: ResizeObserver | undefined;
  let frame = 0;
  const dispose = () => {
    cancelAnimationFrame(frame); resize?.disconnect(); controls?.dispose();
    geometry?.dispose(); material?.dispose(); texture?.dispose();
    renderer?.dispose(); renderer?.domElement.remove();
  };
  try {
    const response = await fetch(base + item.dem);
    if (!response.ok) throw Error('No se pudo leer el DEM');
    const data = new Float32Array(await response.arrayBuffer());
    if (mine !== sequence) return;
    if (data.length !== item.meshRows! * item.meshColumns!) throw Error('Dimensiones del DEM incorrectas');
    texture = await new THREE.TextureLoader().loadAsync(base + item.image);
    if (mine !== sequence) { dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    const span = Math.max(item.width!, item.depth!);
    geometry = new THREE.PlaneGeometry(item.width! / span, item.depth! / span, item.meshColumns! - 1, item.meshRows! - 1);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    const middle = (item.min + item.max) / 2;
    for (let k = 0; k < data.length; k++) position.setY(k, (data[k] - middle) / span);
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#080e16'); scene.add(mesh);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7b7164, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(-1, 2, -1); scene.add(light);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.001, 100);
    camera.position.set(0.95, 0.85, 1.05);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    $('scene').append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.minDistance = 0.1; controls.maxDistance = 5;
    const resizeView = () => {
      const w = $('scene').clientWidth, h = $('scene').clientHeight;
      if (!w || !h) return;
      renderer!.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize = new ResizeObserver(resizeView); resize.observe($('scene')); resizeView();
    const tick = () => {
      frame = requestAnimationFrame(tick);
      mesh.scale.y = Number($<HTMLInputElement>('scale').value);
      controls!.update(); renderer!.render(scene, camera);
    };
    tick(); cleanup = dispose; status('');
  } catch (error) {
    dispose();
    if (mine === sequence) { viewMode('2d'); status(error instanceof Error ? error.message : 'Error al dibujar el relieve'); }
  }
}

function select(item: Raster) {
  ++sequence; cleanup?.(); cleanup = undefined; selected = item;
  viewMode('2d'); status('');
  $('title').textContent = item.title; $('description').textContent = item.description;
  $('source').textContent = item.source; $('reference').textContent = item.reference ?? 'Sin coordenadas geográficas en el archivo.';
  $('stats').replaceChildren();
  for (const [label, value] of [['Dimensiones', `${item.columns} × ${item.rows}`], ['Resolución', item.cell ? `${number(item.cell)} m/px` : 'No especificada'], ['Tipo de dato', item.dem ? 'Elevación' : 'Inercia térmica']]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value;
    $('stats').append(dt, dd);
  }
  $('legend').style.background = `linear-gradient(90deg,${item.colors.join(',')})`;
  $('min').textContent = number(item.min); $('max').textContent = number(item.max); $('unit').textContent = item.unit;
  $<HTMLImageElement>('raster').src = base + item.image;
  $<HTMLImageElement>('raster').alt = `${item.title}, valores ${number(item.min)} a ${number(item.max)} ${item.unit}`;
  $<HTMLAnchorElement>('download').href = base + item.image;
  $<HTMLButtonElement>('relief').disabled = !item.dem;
  $<HTMLInputElement>('scale').value = '1'; $('factor').textContent = '1';
  document.querySelectorAll<HTMLButtonElement>('#datasets button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === item.id)));
  if (mode === '2d') history.replaceState(null, '', `#${item.id}`);
}

$('flat').onclick = () => { ++sequence; cleanup?.(); cleanup = undefined; viewMode('2d'); status(''); };
$('relief').onclick = show3d;
$('scale').oninput = () => { $('factor').textContent = $<HTMLInputElement>('scale').value; };
$<HTMLImageElement>('raster').onerror = () => status('No se pudo cargar la imagen del raster.');
window.addEventListener('pagehide', () => { ++sequence; cleanup?.(); });
async function boot() {
  try {
    const response = await fetch(base + 'manifest.json');
    if (!response.ok) throw Error('No se encontraron los rasters renderizados');
    const items: Raster[] = await response.json();
    for (const item of items) {
      const button = document.createElement('button'); button.textContent = item.title; button.dataset.id = item.id;
      button.onclick = () => select(item); $('datasets').append(button);
    }
    select(items.find(item => item.id === location.hash.slice(1)) ?? items[0]);
  } catch (error) { status(error instanceof Error ? error.message : 'No se pudieron cargar los rasters'); }
}
void boot();
