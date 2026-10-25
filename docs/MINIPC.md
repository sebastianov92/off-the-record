# Instalar Off the Record en la mini PC (CasaOS)

La imagen trae todo: la app, el worker de IA (Demucs y faster-whisper en CPU), ffmpeg con
rubberband (el cambio de tono funciona) y node para yt-dlp. Solo existe para `linux/amd64`
(la mini PC); `sphn`, una dependencia de Demucs, no tiene versión Linux arm64.

Archivos:

- `build_scripts/docker/Dockerfile.ai`: la imagen.
- `build_scripts/docker/entrypoint.sh`: arranca como root solo para darle al usuario de la app
  las carpetas que Docker crea como root, y sigue como ese usuario.
- `build_scripts/docker/publish_ai.sh`: compila y sube la imagen a GHCR.
- `build_scripts/docker/off-the-record.casaos.yml`: el compose para CasaOS (o `docker compose`).

## 1. Publicar la imagen (una vez por versión, desde la Mac)

Permiso para subir paquetes a GitHub (abre el navegador una vez):

```bash
gh auth refresh -h github.com -s write:packages
```

Entrar a GHCR con ese permiso:

```bash
gh auth token | docker login ghcr.io -u sebastianov92 --password-stdin
```

Compilar y subir (desde la raíz del repo; en la Mac compila emulado, ~10–15 min):

```bash
build_scripts/docker/publish_ai.sh
```

La primera vez, el paquete queda privado: en GitHub, Your profile > Packages >
off-the-record > Package settings > Change visibility > Public. Así CasaOS lo baja sin
usuario ni contraseña.

## 2. Instalar en CasaOS

1. CasaOS > App Store > el botón **+** (arriba a la derecha) > **Install a customized app** >
   **Import** y pegar el contenido de `off-the-record.casaos.yml`.
2. Revisar que el comando tenga la IP de la mini PC (`-u http://192.168.18.2:5555`): es la
   dirección que muestra el QR. Si la IP cambia, cambiarla ahí.
3. Instalar. Las carpetas quedan en `/DATA/AppData/off-the-record/` (`songs` y `data`).

## 3. Primer uso

- Celular: `http://192.168.18.2:5555`. Tele: `http://192.168.18.2:5555/splash`.
- **Contraseña de admin**: hasta ponerla, todos son admin. Menú ☰ > Settings, o agregar
  `--admin-password` al comando una vez.
- La primera canción tarda más: baja los modelos (~1,6 GB) a `data/models`. Después, cada
  canción tarda unos 3–4 min en la mini PC; la cola sigue sonando mientras tanto.

## Pasar las canciones de la Mac

Copiar los archivos de `songs/` a `/DATA/AppData/off-the-record/songs/` (por la app Files de
CasaOS o por la red). La base de datos de la Mac no se copia: guarda rutas de la Mac. La mini PC
las encuentra al escanear; en la biblioteca, «Organise library» les pone los datos y el engranaje
de cada canción le quita la voz y le saca la letra (las que bajes desde la mini PC se procesan
solas).

## Actualizar

Volver a correr `publish_ai.sh` en la Mac y, en CasaOS, la app > Settings > Update (o
`docker compose pull && docker compose up -d`). Los datos y los modelos quedan en `data`.
