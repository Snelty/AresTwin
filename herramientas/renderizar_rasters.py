"""Renderiza el TIFF TES y los DEM locales para front/rasters.html.

    .venv/Scripts/python herramientas/renderizar_rasters.py

No modifica datos_crudos/, terreno/ ni el mapa de la simulacion.
Requiere numpy, scipy, pillow y tifffile.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "front/public/rasters"
THERMAL = np.array([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]])
RELIEF = np.array([[38, 49, 65], [112, 82, 66], [177, 124, 80], [219, 181, 128], [250, 237, 199]])


def render(name, title, path, values, unit, description, cell=None, reference=None):
    a = np.asarray(values, dtype=np.float64)
    valid = np.isfinite(a)
    if a.ndim != 2 or not valid.any():
        raise ValueError(f"Raster invalido: {path}")
    lo, hi = float(a[valid].min()), float(a[valid].max())
    t = np.clip((np.where(valid, a, lo) - lo) / max(hi - lo, 1e-12), 0, 1)
    ramp = RELIEF if cell else THERMAL
    rgb = np.stack([np.interp(t, np.linspace(0, 1, len(ramp)), ramp[:, k]) for k in range(3)], axis=-1)
    if cell:
        # North is up in every preview. dz points south, dx east.
        dz, dx = np.gradient(a, cell)
        light = (0.5 * dx - 0.5 * dz + 0.7071) / np.sqrt(dx * dx + dz * dz + 1)
        rgb *= (0.55 + 0.45 * np.clip(light, 0, 1))[..., None]
    rgba = np.dstack((np.clip(rgb, 0, 255).astype(np.uint8), valid.astype(np.uint8) * 255))
    image = Image.fromarray(rgba)
    image.thumbnail((1600, 1200), Image.Resampling.LANCZOS)
    image.save(OUT / f"{name}.png")
    item = dict(id=name, title=title, source=str(path.relative_to(ROOT)).replace('\\', '/'),
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                rows=a.shape[0], columns=a.shape[1], min=lo, max=hi,
                unit=unit, description=description, image=f"{name}.png", reference=reference,
                colors=["#" + "".join(f"{int(c):02x}" for c in row) for row in ramp])
    if cell:
        rows, cols = min(257, a.shape[0]), min(257, a.shape[1])
        y, x = np.meshgrid(np.linspace(0, a.shape[0]-1, rows), np.linspace(0, a.shape[1]-1, cols), indexing='ij')
        sampled = map_coordinates(a, [y, x], order=1).astype('<f4')
        sampled.tofile(OUT / f"{name}.bin")
        item.update(dem=f"{name}.bin", meshRows=rows, meshColumns=cols,
                    width=(a.shape[1]-1)*cell, depth=(a.shape[0]-1)*cell, cell=cell)
    return item


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    raw = ROOT / 'datos_crudos'
    thermal = raw / 'tes/TES_Thermal_Inertia_numeric.tif'
    items = [render('tes', 'TES · inercia térmica', thermal, tifffile.imread(thermal),
                    'J m⁻² K⁻¹ s⁻½', 'Exportación numérica de JMARS. Sin georreferencia: vista independiente; no se ubica sobre el terreno.')]
    dem = raw / 'usgs/dem_gale_1m_ventana.npy'
    meta = json.loads(dem.with_suffix('.json').read_text())
    items.append(render('usgs', 'USGS · DEM original a 1 m', dem, np.load(dem), 'm',
                        'Recorte original de Gale, con margen de 20 píxeles. Norte arriba.', 1,
                        'Elevación respecto al areoide MOLA'))
    manifest = json.loads((ROOT / 'terreno/manifest.json').read_text(encoding='utf-8'))
    package = ROOT / 'terreno/elevacion.bin'
    z = np.fromfile(package, dtype='<f4').reshape(manifest['filas'], manifest['columnas'])
    items.append(render('terreno', 'DEM · ventana de la misión', package, np.flipud(z), 'm',
                        'Paquete de 480 × 480 m utilizado por el simulador. Norte arriba.', manifest['tam_celda_m'],
                        f"Altura sobre z_ref = {manifest['z_ref_m']:g} m"))
    site = json.loads((ROOT / 'front/public/gale/site.json').read_text())
    for name, key, title in [('mid', 'midDem', 'Gale · DEM regional'), ('far', 'farDem', 'MOLA · cráter Gale')]:
        path = ROOT / f'front/public/gale/{name}-dem.bin'
        info = site[key]
        a = np.fromfile(path, dtype='<i2').reshape(info['n'], info['n']) * info['unit']
        items.append(render(name, title, path, a, 'm',
                            'Relieve regional ya disponible en el proyecto. Norte arriba.', 2*info['half']/info['n'],
                            'Altura relativa al sitio regional (distinto del origen de la misión)'))
    # Bounds of pixel centres in scene coordinates (+x east, +z south).
    geo = manifest['georreferencia']
    cx, cy = geo['x_sw_m'] + 240, geo['y_sw_m'] + 240
    regional_x = geo['radio_m'] * np.radians(site['lon']) - cx
    regional_z = cy - geo['radio_m'] * np.radians(site['lat'])
    for item in items:
        x, z = 0.0, 0.0
        if item['id'] == 'usgs':
            x = meta['x_sw_m'] + meta['lado_m']/2 - cx
            z = cy - (meta['y_sw_m'] + meta['lado_m']/2)
        elif item['id'] in ('mid', 'far'):
            x, z = float(regional_x), float(regional_z)
        item['textureRect'] = [x, z, item.get('width', 480), item.get('depth', 480)]
        item['registered'] = item['id'] != 'tes'
    (OUT / 'manifest.json').write_text(json.dumps(items, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    for item in items:
        print(f"{item['id']}: {item['columns']} x {item['rows']}; {item['min']:.2f} .. {item['max']:.2f}")


if __name__ == '__main__':
    main()
