#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
if [ "$(id -u)" != 0 ]; then
    echo 'Ejecutá este archivo con sudo o como root.' >&2
    exit 1
fi
command -v docker >/dev/null
command -v nginx >/dev/null
if ! docker compose version >/dev/null 2>&1; then
    apt-get update
    if apt-cache show docker-compose-plugin >/dev/null 2>&1; then
        apt-get install -y docker-compose-plugin
    elif apt-cache show docker-compose-v2 >/dev/null 2>&1; then
        apt-get install -y docker-compose-v2
    else
        echo 'Falta Docker Compose v2. Instalalo y volvé a ejecutar este archivo.' >&2
        exit 1
    fi
fi
site=/etc/nginx/sites-available/ares-nasa.conf
enabled=/etc/nginx/sites-enabled/ares-nasa.conf
if [ -e "$site" ] || [ -e "$enabled" ] || [ -L "$enabled" ]; then
    echo 'Ya existe ares-nasa.conf. Revisá la instalación existente antes de continuar.' >&2
    exit 1
fi
nginx -t
docker compose -p ares-nasa -f deploy/vps/compose.yaml up -d --build --wait --wait-timeout 240
install -m 644 deploy/vps/nginx.conf "$site"
ln -s "$site" "$enabled"
if ! nginx -t; then
    unlink "$enabled"
    rm "$site"
    echo 'La configuración nueva no pasó la validación y se retiró.' >&2
    exit 1
fi
systemctl reload nginx
curl --fail --silent --show-error -H 'Host: nasa.monterito.dev' http://127.0.0.1/health
printf '\nAplicación preparada. Para activar HTTPS ejecutá:\n  bash deploy/vps/https.sh\n'
