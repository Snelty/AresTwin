"""Empaqueta una compilación existente y sus servicios para el VPS temporal."""
from pathlib import Path
import hashlib
import tarfile
import argparse
import json


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'dist' / 'ares-nasa-mobile.tar.gz'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--solo', action='store_true', help='Empaquetar la compilación VPS individual, sin cambiar dist local')
    parser.parse_args()
    build_dir = ROOT / 'front' / 'dist-vps'
    output = OUTPUT
    if not (build_dir / 'index.html').is_file():
        raise SystemExit('Primero compilá front/: npm run build:vps')
    if json.loads((build_dir / 'deployment.json').read_text()) != {'mode': 'solo', 'target': 'vps'}:
        raise SystemExit('La compilación no corresponde al VPS individual')
    files = set()
    patterns = [
        f'front/{build_dir.name}/**/*', 'front/package.json', 'front/package-lock.json',
        'front/server.js', 'front/sync-core.js', 'terreno/*', 'optimizador/**/*.py',
        'backend/app/**/*.py', 'backend/__init__.py', 'backend/Dockerfile',
        'backend/requirements.txt', 'contratos/**/*.json', 'contratos/**/*.md',
        'logs/sesion-*-mision.jsonl', 'logs/sesion-*-mision.marcadores.json',
        'deploy/vps/*', '.dockerignore',
    ]
    for pattern in patterns:
        for path in ROOT.glob(pattern):
            if path.is_file() and not path.is_symlink() and '__pycache__' not in path.parts:
                files.add(path)
    output.parent.mkdir(exist_ok=True)
    with tarfile.open(output, 'w:gz', compresslevel=6) as archive:
        for path in sorted(files):
            name = (Path('front/dist') / path.relative_to(build_dir)) if path.is_relative_to(build_dir) else path.relative_to(ROOT)
            archive.add(path, arcname=name.as_posix(), recursive=False)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix + '.sha256').write_text(f'{digest}  {output.name}\n', encoding='ascii')
    print(f'{output}\n{len(files)} archivos · {output.stat().st_size / 1024**2:.1f} MiB\nSHA256: {digest}')


if __name__ == '__main__':
    main()
