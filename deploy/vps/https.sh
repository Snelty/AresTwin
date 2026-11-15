#!/bin/sh
set -eu
if [ "$(id -u)" != 0 ]; then
    echo 'Ejecutá este archivo con sudo o como root.' >&2
    exit 1
fi
domain=nasa.monterito.dev
if ! getent ahostsv4 "$domain" | awk '{print $1}' | grep -qx '149.56.110.146'; then
    echo 'El DNS todavía no devuelve 149.56.110.146. Revisá el registro A nasa y elegí Solo DNS.' >&2
    exit 1
fi
if ! command -v certbot >/dev/null 2>&1 || ! certbot plugins 2>/dev/null | grep -q nginx; then
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
fi
nginx -t
certbot --nginx -d "$domain" --redirect
curl --fail --silent --show-error "https://$domain/health"
printf '\nLaptop: https://%s/?role=spectator\nVR: https://%s/?role=vr\n' "$domain" "$domain"
