# PiKaraoke de Dezik: cambios respecto de pikaraoke

Fork de [vicwomg/pikaraoke](https://github.com/vicwomg/pikaraoke) (GPL-3.0), tomado de `master`
en `5a9f3d8` (versión 1.23.0). Todo el trabajo propio vive en la rama `karaoke-ai`.

La regla del fork: el código nuevo va en paquetes y archivos propios; al código de pikaraoke solo se
le agregan enganches chicos, para que traer actualizaciones de upstream siga siendo fácil.

## Qué agrega

| Función | Dónde |
| --- | --- |
| Quitar la voz de una canción (Demucs) | `pikaraoke/ai/separate.py` |
| Letra palabra por palabra (faster-whisper); inicios, palabras estiradas y cortes de línea corregidos con la energía de la voz (respiros) | `pikaraoke/ai/transcribe.py`, `pikaraoke/ai/lyrics.py` |
| Letra publicada de LRCLIB, sincronizada palabra por palabra con los tiempos de Whisper (anclajes por sonido, desfase con los tiempos por línea); Whisper solo si no hay | `pikaraoke/ai/lrclib.py`, `pikaraoke/ai/align.py` |
| Identidad del artista (id y alias de MusicBrainz), año original y carátula de respaldo (Cover Art Archive) | `pikaraoke/catalog/musicbrainz.py` |
| Detección de «sin voz» (pistas que ya son karaoke) | `pikaraoke/ai/pipeline.py` |
| Worker de IA en su propio proceso, con cola en SQLite | `pikaraoke/ai/worker.py`, `pikaraoke/ai/store.py`, `pikaraoke/ai/service.py` |
| Reproducción con la pista sin voz (solo audio) y voz guía ajustable | `pikaraoke/ai/service.py`, `static/ai/splash.js` |
| La cola espera a las canciones que aún se procesan | `lib/queue_manager.py` (enganche) |
| Pantalla de TV: letra que se rellena palabra por palabra sobre 4 fondos animados (flow, mesh, orb, fiber) × 20 paletas | `static/ai/lyrics.js`, `static/ai/backgrounds.js`, `static/ai/stage.css` |
| Control desde el celular: voz guía, desfase de la letra, otro fondo | `templates/home.html` |
| Biblioteca ordenada: canciones y artistas, buscador sin tildes, filtros, subir canciones | `pikaraoke/catalog/`, `templates/library.html`, `static/catalog/library.js` |
| Artistas únicos (variantes escritas, unir, renombrar) y metadatos de iTunes con carátula | `pikaraoke/catalog/artists.py`, `store.py`, `enrich.py` |
| Búsqueda de originales por defecto y descarga solo de audio (m4a) que se procesa sola | `templates/search.html`, `lib/youtube_dl.py`, `lib/download_manager.py` |
| Puntaje real con micrófono (melodía de referencia + detector de tono) y «Mejores puntajes» | `pikaraoke/ai/pitch.py`, `static/ai/scoring.js`, `static/ai/score.js`, `static/ai/pitch-worklet.js` |
| Pantalla de conversiones en vivo (etapas, tiempo, estimado, cola, terminadas) | `templates/processing.html`, `static/ai/processing.js` |
| Avatares (blobatar, MIT, copiado en `static/blobatar`): cada nombre genera su cara; en el menú, la vista previa de Perfil, la cola, Inicio, el mini player y en grande en la tele (abajo a la derecha, sobre «Up next»; mientras se ve, la esquina de arriba muestra solo la canción y el tiempo); en la tele cambia de expresión mientras canta (con micrófono según la afinación de los últimos 2,5 s: enamorado, feliz, normal, dudoso, sorprendido, dormido si no canta, pensando en las partes sin melodía; sin micrófono sigue la letra) y en la pantalla de puntaje (fondo propio: una sala con un micrófono, `static/brand/score-room.jpg`, con el logo arriba) aparece junto al micrófono con la cara de la nota y celebra en bucle (salta y gira con nota alta, se balancea feliz, se mece tímido con nota baja) | `static/ai/avatars.js`, `static/ai/scoring.js` (`mood`, `finalMood`), `static/ai/score.js`, `static/ai/splash.js`, `static/ai/lyrics.js` (`state`), `static/ai/stage.css`, `static/skin.css` |
| El avatar de la tele baila: el worker calcula los golpes del instrumental (`beats.json`: flujo espectral, tempo por autocorrelación, golpes por programación dinámica, solo numpy; las canciones viejas lo reciben al arrancar el worker) con un paso de baile por compás (balanceo, saltitos, cabeceo, mirar alrededor; el orden sale del nombre), parpadeos y una vuelta completa cada 8 compases cuando está feliz; baila menos con caras tranquilas y apenas se mece dormido | `ai/beats.py`, `ai/pipeline.py`, `ai/worker.py`, `ai/routes.py`, `ai/service.py`, `static/ai/splash.js`, `static/ai/avatars.js`, `static/ai/stage.css` |
| Reposo de la tele: degradado animado propio (estilo flow, índigo #4A00E0, violeta #8E2DE2, rosa claro #FF6FB5) en lugar del video del mar; el video por defecto ya no se carga, uno elegido con `--bg-video-path` se respeta | `static/ai/splash.js`, `static/ai/backgrounds.js` (`showPalette`), `static/ai/stage.css`, `ai/service.py` |
| Nombre y logo «Off the Record» (antes «Liria»): títulos, textos, mensajes y los 15 idiomas; los logos del usuario en `static/brand/` (lienzo recortado al contenido): `logo-white.svg` (versión sticker) en la tele y en Info, `isologo.svg` como ícono de la pestaña, `logo-black.svg` para fondos claros. `/logo` sirve el tipo del archivo (SVG). Info dice que Off the Record es un fork de PiKaraoke y enlaza a su GitHub | `app.py` (`SITE_NAME`), `karaoke.py` (logo por defecto), `routes/images.py`, `templates/base.html`, `templates/info.html`, `translations/` |
| Nombre obligatorio en la primera visita: el diálogo de Perfil (con la vista previa del avatar) se abre solo si el dispositivo no tiene nombre, sin ✕ ni Cancelar, sin cerrar con Escape ni con clic afuera; la tele no lo pide | `templates/base.html` (`requireName`), `static/spa-navigation.js` (`required` en `promptForText`) |
| Inicio reordenado: lo que suena con su avatar y los controles de reproducción centrados (reiniciar y saltar piden un segundo toque), lo que sigue, Volúmenes (música, voz guía, micrófonos), Pantalla de karaoke (sincronía de letra, otro fondo) y Cambiar tono; el mini player se oculta en Inicio | `templates/home.html`, `static/skin.css` |
| Admin con contraseña: Conversiones, Play History, Sessions y Settings solo para el admin (ni se ven en el menú para el resto); inicio y cierre de sesión desde el menú lateral, volviendo a la misma página; sin contraseña puesta todos son admin, como en upstream | `templates/partials/admin_login.html`, `templates/base.html`, `routes/admin.py` |
| Mini reproductor fijo abajo en todas las páginas: reiniciar, pausa, siguiente (reiniciar y pasar piden un segundo toque, sin diálogos del navegador), volumen de música y de voz | `templates/partials/mini_player.html`, `static/ai/miniplayer.js` |
| Diseño espacial (Spatial UI, estilo visionOS) en la app del celular: un ambiente de luces de color que se mueve detrás, ventana de vidrio esmerilado con borde iluminado, navegación y mini reproductor como cápsulas flotantes (la barra y el menú ☰ en negro sólido; dentro del menú de la tele la página va sobre negro, sin las luces), campos y pestañas hundidos, botones cápsula (la acción principal en blanco), filas que se elevan al pasar el puntero; Inter incluida; respeta reducir movimiento y transparencia; en pantallas táctiles todo control mide 44 px o más, los campos usan 16 px (sin zoom en iPhone) y el vidrio desenfoca menos; la pantalla de la tele no cambia | `static/skin.css`, `static/fonts/inter/` |
| App para la tele LG (webOS): la pantalla de karaoke con controles por control remoto (reiniciar, pausa, siguiente, volúmenes de música y voz guía), micrófono USB con un motor nativo (`otr-mic`: filtro, expansor, EQ de 5 bandas con estilos, compresor, de-esser, eco, reverb, anti-acople, limitador), salida por la tele o un parlante USB, puntaje con el tono del motor y calibración. Ver `docs/WEBOS.md` | `webos/`, `static/ai/tv-bridge.js`, `static/ai/pitch-clock.js`, `static/ai/buffer-guide.js` (la voz guía por Web Audio en la tele, en WAV: `ai/routes.py` `?format=wav`), `static/ai/score.js` (`useFeed`, `feed`), `static/ai/splash.js` |
| Antes de descargar, busca la canción en la biblioteca: el mismo video de YouTube, o la misma canción (artista y título según iTunes); si está, la pone en cola y no descarga ni procesa nada | `lib/download_manager.py` (`_library_copy`), `lib/song_list.py` (`with_youtube_id`), `catalog/service.py` (`find_in_library`), `catalog/store.py` (`find_song`), `karaoke.py` (`announce_library_copy`) |
| Cuando YouTube bloquea la conexión (pide confirmar que no es un bot, o 429) no reintenta y lo explica; Ajustes acepta un cookies.txt de una cuenta de YouTube (solo admin, guardado privado) que yt-dlp usa en descargas, búsquedas y vistas previas | `lib/download_manager.py`, `lib/youtube_dl.py` (`youtube_cookies_file`), `routes/settings.py`, `templates/settings.html` |
| Borrar una canción desde la Biblioteca (en su ventana de edición, solo admin, con segundo toque): se van también sus pistas de karaoke y sus créditos; no deja borrar una que está en cola o sonando | `catalog/routes.py` (`delete_song`), `static/catalog/library.js`, `templates/library.html` |
| La app de la tele guarda en la tele copias de las próximas 5 canciones (la que suena y la cola), borra las que ya se cantaron y las toca desde la tele | `routes/tv_api.py`, `lib/stream_manager.py` (`direct_source`), `karaoke.py` (`now_playing_file`), `static/ai/tv-bridge.js`, `webos/tv/otr-files.py` |
| Textos en español | `translations/es_VE/LC_MESSAGES/messages.po` (bloque al final) |

## Archivos nuevos

- `pikaraoke/ai/beats.py` (golpes de cada canción).
- `pikaraoke/ai/`: `audio.py`, `separate.py`, `transcribe.py`, `lyrics.py`, `lrclib.py`, `align.py`, `pitch.py`, `pipeline.py`,
  `store.py` (tablas `ai_songs` y `ai_scores`), `worker.py`, `service.py`, `routes.py`.
- `pikaraoke/catalog/`: `artists.py`, `musicbrainz.py`, `store.py` (tablas `artists`, `artist_aliases`, `song_artists`,
  `song_details`), `enrich.py`, `service.py`, `routes.py`.
- `pikaraoke/static/ai/`: `splash.js`, `lyrics.js`, `backgrounds.js`, `stage.css`, `library.js`,
  `scoring.js`, `score.js`, `pitch-worklet.js`, `processing.js`.
- `pikaraoke/static/catalog/library.js`, `pikaraoke/static/skin.css`, `pikaraoke/static/fonts/inter/` (Inter, SIL OFL 1.1).
- `pikaraoke/templates/library.html`, `pikaraoke/templates/processing.html`, `pikaraoke/templates/partials/mini_player.html`, `pikaraoke/templates/partials/admin_login.html`, `pikaraoke/static/ai/avatars.js`, `pikaraoke/static/blobatar/` (blobatar 2.7.0, MIT), `pikaraoke/static/brand/` (logos).
- `pikaraoke/static/ai/miniplayer.js`.
- `webos/`: la app de la tele (ver `docs/WEBOS.md`), con su motor `webos/engine/` (C; tinyalsa BSD-3 y jsmn MIT en `vendor/`) y `webos/tv/otr-mic.sh`; `pikaraoke/static/ai/tv-bridge.js`, `pitch-clock.js` y `buffer-guide.js` (el lado del servidor); `.github/workflows/webos.yml` (publica el IPK y el manifest del feed).
- Docker para la mini PC (ver `docs/MINIPC.md`): `build_scripts/docker/Dockerfile.ai` (Debian, torch solo CPU, ffmpeg estático con rubberband, node; solo `linux/amd64`), `entrypoint.sh`, `publish_ai.sh`, `off-the-record.casaos.yml`; `pikaraoke/static/brand/app-icon.png` (ícono de CasaOS y del iPhone).
- `tools/make_test_song.py`: canción sintética con tiempos conocidos (letra original).
- Pruebas: `tests/js/pitch_clock.test.js`, `tests/js/ai_score_feed.test.js`, `tests/js/tv_bridge.test.js`, `tests/unit/test_ai_guide.py`, `tests/unit/test_catalog.py`, `tests/unit/test_ai_pitch.py`, `tests/unit/test_ai_lyrics.py`, `tests/unit/test_ai_align.py`, `tests/js/ai_scoring.test.js`.

Datos que escribe fuera del repo: `~/.pikaraoke/ai/<song_id>/` (pistas, letra, melodía) y
`~/.pikaraoke/catalog/covers/` (carátulas). Fuera de `songs/` a propósito: el escáner de pikaraoke
recorre todas las subcarpetas y tomaría las pistas como canciones.

## Archivos de pikaraoke modificados

| Archivo | Cambio |
| --- | --- |
| `pyproject.toml` | Extra opcional `ai` (torch, demucs, faster-whisper, numpy) y `[tool.uv] environments` sin Mac Intel |
| `uv.lock` | Dependencias de `ai`; yt-dlp actualizado |
| `app.py` | Crea y arranca `AiService` y `CatalogService`; global de plantilla `has_admin_password` |
| `routes/admin.py` | `/auth` vuelve a la página de donde vino (`next`, solo rutas locales); `/logout` va a Inicio |
| `routes/settings.py`, `routes/sessions.py`, `routes/sessions_api.py` | Settings, Play History y su API pasan a ser solo para el admin (sin `@public`) |
| `static/spa-navigation.js` | `promptForText` acepta `required`: sin cancelar, para pedir el nombre en la primera visita |
| `templates/rankings.html` | Los nombres enlazan a Play History solo para el admin |
| `karaoke.py` | El bucle principal solo arranca canciones listas; `now_playing` lleva `now_playing_ai` |
| `lib/queue_manager.py` | `is_ready` y `next_ready_index`: una canción en proceso deja pasar a la siguiente, con aviso |
| `lib/stream_manager.py` | `audio_source`: reproduce la instrumental en lugar del audio original |
| `lib/file_resolver.py` | `audio_override` y `audio_only`; los `.m4a` se reproducen solo como audio |
| `lib/ffmpeg.py` | Salida solo de audio cuando no hay video |
| `lib/song_list.py` | `.m4a` es un formato válido |
| `lib/youtube_dl.py` | `audio_only`: baja el mejor audio y lo deja en m4a |
| `lib/download_manager.py` | Pasa `audio_only` por la cola de descargas y los reintentos |
| `lib/metadata_providers.py` | iTunes devuelve también `artist_id`, `album` y `artwork` |
| `lib/play_history_manager.py` | Propiedad `current_play_id` (para ligar el puntaje a la reproducción) |
| `routes/__init__.py` | Registra `ai_bp` y `catalog_bp` |
| `routes/search_api.py` | Campo `audio_only` en `/api/download` |
| `templates/base.html` | Carga `skin.css`; el ícono de canciones va a `/library`; ítem «Conversiones» en el menú; Conversiones, Play History, Sessions y Settings solo para el admin; «Admin» / «Log out» en el menú; mini reproductor para el admin; carga `ai/avatars.js`; nombre accesible (`aria-label`) en Inicio y Cola, que en el celular quedan solo con ícono |
| `templates/search.html` | Originales por defecto; pide solo audio salvo títulos con «karaoke» o «instrumental»; nombre accesible en el buscador |
| `templates/queue.html` | Nombre accesible en el «+» que agrega canciones al azar; avatar junto a quien canta en cada fila |
| `templates/home.html` | Reordenada en tarjetas (lo que suena y sus controles, lo que sigue, volúmenes, pantalla de karaoke, tono); avatar junto a quien canta y quien sigue; reiniciar y saltar con segundo toque |
| `templates/files.html` | Etiquetas de estado de IA y botón «Procesar» en la vista de archivos |
| `templates/home.html` | Voz guía, desfase de la letra y «Otro fondo» |
| `templates/splash.html` | Escenario de IA, scripts de puntaje, desglose y logo en la pantalla de puntaje; el puente de la app webOS |
| `templates/rankings.html` | Sección «Mejores puntajes» |
| `static/js/splash.js` | `endSong` muestra puntaje solo si hubo canto medido |
| `static/score.js`, `static/score.css` | El puntaje viene del micrófono (se quitó el azar) y muestra el desglose |
| `static/fireworks.js` | Los fuegos artificiales del puntaje son solo blancos |
| `.dockerignore` | Deja fuera del contexto de Docker `songs/`, `node_modules/`, `branding/` y `webos/` |
| `lib/admin_auth.py`, `lib/current_app.py`, `routes/auth_api.py` | Token de dispositivo para la app de la tele: `POST /api/auth` con `issue_token` lo entrega, `is_admin()` acepta la cabecera `X-Admin-Token` (deriva del token de sesión: cambiar la contraseña lo revoca; sin CORS, ningún otro sitio puede mandarla) |
| `routes/controller.py` | `/api/volume` limitado a 0–1 (la splash lo asigna a `video.volume`, que falla fuera de ese rango) |
| `vitest.config.js` | Cobertura también del puente webOS |
| `static/screensaver.js`, `static/screensaver.css` | El salvapantallas es solo el isologo rebotando, sin la caja de colores ni el QR |
| `translations/es_VE/.../messages.po` | ~80 textos nuevos al final del archivo, sin tocar los existentes |
| `tests/conftest.py`, `tests/unit/test_auth_gate.py`, `tests/unit/test_metadata_providers.py`, `tests/unit/test_queue_manager.py`, `tests/js/splash.test.js` | Stubs y listas de endpoints públicos al día; pruebas de la cola y del puntaje |

## Correr en desarrollo

```bash
uv sync --extra ai --extra dev --all-groups
uv run --extra ai pikaraoke -d songs --headless -p 5555
```

Celular: `http://<ip>:5555` · Tele: `http://<ip>:5555/splash`.

## Traer cambios de upstream

```bash
git fetch upstream
git merge upstream/master
```

- **`uv.lock`:** si choca, quedarse con el de upstream y correr `uv lock` (vuelve a sumar el extra `ai`).
- **`messages.po`:** nuestras traducciones están en un bloque al final; si upstream regenera el archivo, volver a pegar ese bloque y compilar el `.mo`. No reescribir el `.po` con `write_po`: reformatea todo.
- **Endpoints públicos nuevos:** sumarlos a `EXPECTED_PUBLIC_ENDPOINTS` en `tests/unit/test_auth_gate.py`.
- **Endpoints que enlaza `base.html`:** agregarlos a `_BASE_TEMPLATE_ENDPOINTS` en `tests/conftest.py`.
- **Pruebas:** `uv run --extra dev --extra ai pytest tests/unit` y `npx vitest run`.

## Servicios externos

- **LRCLIB** (`lrclib.net`): letras; sin clave. La copia queda en `~/.pikaraoke/ai/<id>/reference.json` (uso personal, no se redistribuye).
- **MusicBrainz**: máximo 1 consulta por segundo y User-Agent propio; responde 503 si se le pide muy rápido (hay reintentos).
- **iTunes Search**: género, carátula y búsqueda (ya venía en pikaraoke).

## Pendiente

- Publicar la imagen en GHCR e instalarla en la mini PC (`docs/MINIPC.md`); probada solo en Docker de la Mac (emulado).
- App webOS: probarla en la tele (latencia por la tele y por USB, CPU del motor, que hw:0,5 suene junto a la música, calibración del puntaje) y publicar el primer release.
- Probar el puntaje con un micrófono real.
- Si la sincronía con anclajes no alcanza en canciones rápidas: alineación forzada con wav2vec2/MMS.
