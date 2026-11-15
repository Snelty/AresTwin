Publicación temporal en https://nasa.monterito.dev

La versión individual se compila en `front/` con `npm run build:vps` y se empaqueta
con `python herramientas/preparar_vps.py --solo`. Se escribe en `front/dist-vps` y
`dist/ares-nasa-mobile.tar.gz`; `front/dist` y el comportamiento local se conservan.
Incluye los cambios actuales del simulador, texturas, TIFF/DEM
renderizados, terreno científico, backend y registro de misión de ejemplo.
Excluye credenciales, repositorio Git, entornos virtuales y dependencias de la PC.

1. Cloudflare: registro A `nasa` → `149.56.110.146`, Solo DNS.
2. Subir `ares-nasa-mobile.tar.gz` a `/root/` usando el SFTP de Bitvise.
3. En la terminal del VPS:

```sh
mkdir -p /opt/ares-nasa
tar -xzf /root/ares-nasa-mobile.tar.gz -C /opt/ares-nasa
cd /opt/ares-nasa
bash deploy/vps/arrancar.sh
bash deploy/vps/https.sh
```

La primera compilación descarga imágenes y dependencias. Certbot puede pedir
un correo y la aceptación de sus condiciones. El script agrega un sitio Nginx
para `nasa.monterito.dev` y valida la configuración antes de recargar Nginx.
Los puertos 3100 y 8100 se publican solo en localhost. El proyecto Docker se
llama `ares-nasa`; tiene su propio volumen para los registros del backend.

Abrir `https://nasa.monterito.dev/?role=spectator` para jugar en PC o
`https://nasa.monterito.dev/?role=mobile` para jugar desde el celular.
Cada dispositivo calcula su movimiento, oxígeno, ruta, clima y catálogo JARVIS.
El celular tiene pantalla normal, joystick para caminar y arrastre para mirar.
No pide sensores ni usa pantalla dividida. Al soltar el joystick se detiene;
mirar el suelo no inicia el avance. Los teléfonos se detectan automáticamente.
Los enlaces antiguos con `?role=vr` abren esta misma vista móvil en el VPS.
No hay multijugador ni control compartido.
Esta compilación ofrece modo libre y misión registrada individual en PC; el modo
de backend en vivo compartido se conserva solo para la versión local.
El servidor VPS se inicia con `ARES_SOLO=1` y no retransmite estado entre dispositivos.
La versión local normal continúa sincronizando la PC con el casco.

Para actualizar un VPS ya instalado (no repetir la instalación de Nginx/HTTPS):

```sh
tar -xzf /root/ares-nasa-mobile.tar.gz -C /opt/ares-nasa
cd /opt/ares-nasa
docker compose -p ares-nasa -f deploy/vps/compose.yaml up -d --build --wait frontend
```

Recargar las páginas de PC y celular al terminar la actualización.

Consultar estado y registros:

```sh
cd /opt/ares-nasa
docker compose -p ares-nasa -f deploy/vps/compose.yaml ps
docker compose -p ares-nasa -f deploy/vps/compose.yaml logs --tail=80
```

Detener la demo:

```sh
cd /opt/ares-nasa
docker compose -p ares-nasa -f deploy/vps/compose.yaml stop
```

Reanudarla: reemplazar `stop` por `start`. Para actualizar los contenedores,
ejecutar `up -d --build --wait`; no es necesario repetir `arrancar.sh`.
