# Prueba en la tele (F1) — 2026-10-25

TV LG, webOS 9.2.2 «Rockhopper» (ombre-okapi), kernel 5.4 aarch64, root por SSH con clave.

| Qué | Resultado |
| --- | --- |
| CPU | 4 núcleos: 2 Cortex-A75 + 2 Cortex-A55; carga constante ~28; 1,2 GB de RAM (236 MB libres) |
| Espacio de usuario | 32 bits (`/bin/busybox` ELF de clase 1) sobre kernel de 64: corren el binario armv7l y el aarch64 |
| Tiempo real | `SCHED_FIFO` permitido (`rt: true`) |
| Tarjetas | 0 y 1 «Mars» (ADSP de LG), 2 el micrófono USB (Logitech, 48 kHz mono) |
| PCMs de salida | hw:0,0–0,7 aceptan 16–48 kHz, 1–2 canales, period 128–12000, 4+ periods; PulseAudio tiene 0,6 (apps) y 0,7 (voz); 0,5 queda libre |
| Motor + música a la vez | Sí: hw:0,5 (motor) y hw:0,6 (PulseAudio, `paplay`) en RUNNING juntos, `paplay` sin error |
| Modo de sonido | `otr-mic.sh` lo pone en «game» al arrancar y vuelve a «standard» al terminar |
| Retraso de la voz por la tele | De micrófono a oído, con la cola propia de 5–13 ms incluida. **hw:0,7 en modo juego: 64–72 ms**; hw:0,5 en modo juego: 114–125 ms; cualquiera de las dos en modo estándar: 117–125 ms. A veces el procesador queda ~50 ms más lento (173–178 ms por hw:0,7), sobre todo si la salida se abre con una canción sonando; cerrar y reabrir no lo arregla. Antes la app usaba hw:0,5 y la reabría en cada canción: 170 ms |
| Otras salidas a la vez | Con otra salida del procesador abierta al mismo tiempo, cualquiera queda en 112–120 ms |
| hw:0,4 | No suena por los parlantes |
| Controles del procesador | `Low Latency Mode`, `Audio Latency Time`, `Delay InputOutput` existen pero no se pueden escribir («Operation not permitted») y no cambian entre el estado rápido y el lento |
| hw:0,7 y la música | Abrirla no baja la música (medido: igual nivel con y sin ella) |
| CPU del hilo de audio | ~6 % de un núcleo (máx. 7,9 %) |
| Cortes (xruns) | 0 en todas las corridas |
| Ajustes de deriva (slips) | 2 al arrancar (la cola se llena); 0 en los 24 s siguientes |
| Tono con la sala en silencio | 0 tramas con tono (sin falsos positivos) |
| App instalada | Se instala con `appInstallService/dev/install`; lanzada con `params.server` abre el karaoke, lanza el motor por `exec` de Homebrew y se conecta a `ws://127.0.0.1:47830` |
| Captura de pantalla | `com.webos.service.capture` no responde en este firmware |
| Reproductores con sonido | **Uno a la vez**: todos comparten la única salida de sonido de medios (`MAIN_SOUND`); el último que empieza se la queda y LG pausa al otro. Web Audio sale aparte, por PulseAudio (hw:0,6, ~74 ms de colas propias), junto a la canción |
| Velocidad de reproducción | LG ignora `playbackRate`: el reproductor dice 1,1 y avanza a 1,0. Como pantalla secundaria (otra splash manda) la tele queda atrás: medido 0,3 s; se vuelve a alinear solo si pasa de 2 s |
| Binario aarch64 | Corre; `otr-mic.sh` lo prefiere con `uname -m` aarch64 |
| Voz guía con la música | **2–14 ms** de diferencia en 2 arranques con el ajuste final (antes: 4–37 ms, y 100 ms con el primer cálculo). Medido grabando la sala con el micrófono USB y ubicando cada pista en la grabación por correlación |
| Reloj de Web Audio | Dibuja en tandas de 1024 muestras: `currentTime` salta de a 43 ms; `getOutputTimestamp()` es estable a ±5 ms y es el que usa la guía. `baseLatency` 85 ms, `outputLatency` siempre 0 |
| Decodificar la guía | AAC de 4 min: 10,4 s en la tele; WAV mono de 24 kHz (12 MB): al instante. La app pide `/ai/guide/<id>?format=wav` |
| Espacio libre | `/media/developer` (partición de las apps): ~400 MB; `/home` y `/var` (partición del sistema): ~470 MB. Hay `curl`, `wget` y Python 3.10; no hay `httpd` |
| Copias de las canciones | Probado con la app: baja las canciones de la cola a `/media/developer/otr-cache`, toca desde la tele la que ya estaba copiada (también al reiniciarla), borra la que se cantó; una que empieza antes de que llegue su copia sigue por streaming |
| Inspector web | El puerto 9998 de la tele (modo desarrollador) sirve las DevTools de las apps abiertas |

## Encontrado y corregido

- `otr-mic.sh` se relanzaba con `$0`; llamado con ruta relativa no se encontraba. Ahora usa la ruta
  completa de su carpeta y `sh`.
- La cola de salida estaba en 256–1280 muestras de mínimo; bajó a 192–640 (−30 ms).
- El relevo de prueba `karaoke2.py` de la sesión anterior seguía corriendo y tenía tomados el
  micrófono y hw:0,6 (el sonido de las apps). Se detuvo; el script sigue en la tele.
- La canción quedaba en 00:00 en la app: la voz guía (un segundo `<audio>`) le quitaba la
  salida de sonido a la canción, LG pausaba la canción y la splash pausaba la guía tras ella. En
  la app la guía ahora suena por Web Audio (`pikaraoke/static/ai/buffer-guide.js`). Verificado en
  la tele: arranque desde 0, reinicio, canción nueva, y la tele como pantalla secundaria.
- La espera de 3 s antes de devolverle la salida de la tele al motor sobraba (la pausa era la
  guía): la retoma apenas la canción suena; verificado en 3 arranques.
- La guía por Web Audio salía 100 ms antes que la música (se adelantaba lo que Web Audio dice
  que tarda) y cambiaba ±40 ms en cada arranque (tomaba la hora de `currentTime`, que salta).
  Ahora se ubica con `getOutputTimestamp()` y la splash la mantiene a 40 ms (no 150) de la
  canción. Además los primeros ~10 s de cada canción sonaban sin guía mientras se decodificaba:
  ahora llega en WAV y está lista antes de que arranque la canción.
- La app cerraba y reabría la salida de la tele en cada canción porque el decodificador de LG
  «no arrancaba» con ella abierta; en realidad era la voz guía. Con hw:0,5 o hw:0,7 abiertas
  todo el tiempo las canciones arrancan bien, así que la salida ya no se suelta. Reabrirla con
  la canción sonando era lo que dejaba el procesador en su estado lento.
- La salida de la tele pasó a hw:0,7 (la de la guía hablada de LG), con hw:0,5 si está ocupada.
- «Sincronizar puntaje» toca sus clics con un segundo reproductor: con una canción sonando, la
  tele la pausaría. El botón queda apagado mientras suena una canción.
- Los fondos de la letra se veían solo en un rectángulo abajo a la izquierda: la GPU de la tele
  (PowerVR) calcula `mediump` con 16 bits y el ruido de los shaders se desbordaba. Ahora piden
  `highp` cuando la GPU lo tiene (la tele sí): pantalla completa, a los mismos 25 cuadros.
- La app no podía hablar con `otr-files`: su propia política de seguridad (CSP) solo permitía
  conectarse al motor. Y en un servidor HLS (el de fábrica) la copia no se tocaba: la página
  decide entre hls.js y un archivo antes de cambiar la dirección, y hls.js dejaba su `src`
  puesto. Ahora la página pide la copia antes de decidir (`window.tvSongCopy`) y borra ese `src`.
- Un motor que no contestaba tras relanzarse dejaba la app en «falló» para siempre. Ahora la app
  lo relanza a 1 s, 2 s, 4 s… hasta 30 s. Verificado: `kill -9` al motor, vuelve en 1 s y la
  canción sigue.

## Pendiente

- Qué deja exactamente al procesador en su estado ~50 ms más lento. Se vio después de abrir la
  salida con una canción sonando y después de pruebas con `aplay` cortado a la fuerza; abrir
  otra salida a la vez lo sacó de ahí. Si vuelve a pasar en uso real, ver si conviene medir al
  arrancar la app.
- Prueba larga (30–60 min) de cortes, ajustes y CPU con alguien cantando.
- Salida por tarjeta USB: no hay una conectada.
- Calibración del puntaje con alguien cantando una canción con melodía de referencia.
