# Off the Record en la tele LG (webOS)

La app de la tele muestra la pantalla de karaoke (`/splash`) del servidor y suma lo que
el navegador de la tele no puede hacer: controles con el control remoto y el micrófono
USB con su cadena de voz. Necesita una tele LG rooteada con Homebrew Channel.

## Instalar

En Homebrew Channel, el mismo repositorio de LumiOS:
`https://github.com/sebastianov92/LumiOS/releases/latest/download/repo.json`. Off the
Record aparece en la lista; necesita root.

Al abrirla por primera vez pide la dirección del servidor (`192.168.18.2` basta: completa
`http://` y el puerto 5555). Si el servidor tiene contraseña de admin, la pide una vez y
guarda solo un token; cambiar la contraseña en el servidor lo invalida.

## Con el control remoto

| Tecla | Hace |
| --- | --- |
| OK o las flechas | Abren el panel de abajo (se oculta solo a los 8 s) |
| Atrás | Cierra el panel; sin panel, pregunta si salir (salir corta la canción) |
| ⏯ / ▶ / ⏸ | Pausa o reanuda |
| ⏩ | Siguiente canción (presionar dos veces en 3 s) |
| ⏪ | Reinicia la canción (dos veces en 3 s) |
| Rojo | Silencia o activa el micrófono |
| CH+ / CH− | Sube o baja «Mi voz» |

En el panel: Reiniciar, Pausa y Siguiente; volúmenes de **Música**, **Voz del artista** (la
voz guía de la canción; gris si la canción no la tiene) y **Mi voz**; **Voz** (estilo,
ecualizador de 5 bandas, eco, reverb, suavizar las «s», anti-acople) y **Salida**.

## El micrófono

Un micrófono USB, enchufado a la tele. La app lanza `otr-mic`, un programa nativo que lo
lee (el navegador de la tele solo recibe silencio de LG), procesa la voz y la manda a la
salida elegida. Su tono alimenta el puntaje y las caras del avatar.

**Salida** (panel Salida):

- **Parlantes de la tele.** El procesador de audio de LG suma un retraso que ningún programa
  quita. La app usa su salida más corta (la de la guía hablada de la tele, hw:0,7) y pone el
  sonido en modo «juego» mientras canta: unos 70 ms del micrófono al oído (120 ms con la
  salida de siempre). Lo devuelve al modo de antes al salir. Si la guía hablada de la tele
  está ocupando esa salida, la app usa la otra. El eco de la voz se ajusta a ese retraso, así
  suena como la primera repetición de un eco de karaoke en vez de un desfase.
- **Parlante USB.** Una tarjeta de sonido USB (unos 10 USD) conectada a un parlante aparte:
  la voz no pasa por el procesador de LG, casi sin retraso. Una interfaz USB con entrada de
  micrófono y salida a la vez es lo mejor: comparte reloj y nunca se desfasa.
- **Sin amplificar.** La voz no sale por ningún lado; el micrófono solo mide la afinación.

**Medir retraso** toca tres pitidos y mide cuánto tardan en volver al micrófono.
**Sincronizar puntaje** toca clics por el mismo camino que la música y mide cuándo los
escucha quien canta; el puntaje usa ese número. Se hace sin canción sonando: la tele solo
deja sonar un reproductor a la vez y pausaría la canción.

**Para que no acople:** ganancia del micrófono moderada (la app la pone en 10 de 13),
micrófono cerca de la boca y detrás de los parlantes. El anti-acople corta las frecuencias
que empiezan a silbar con filtros angostos (hasta seis) y los suelta a los 30 s.

## Cómo funciona

```
otr-mic (C, root)  <--ws 127.0.0.1 + token-->  app (file://, Homebrew exec)
                                                   |  postMessage v1
                                                   v
                                    iframe /splash?client=webos  (tv-bridge.js)
                                                   |  REST + X-Admin-Token
                                                   v
                                          servidor (mini PC)
```

- **App** (`webos/src`): React. Es la única que habla con el motor; la página del
  servidor nunca toca un proceso root.
- **Puente** (`pikaraoke/static/ai/tv-bridge.js`): solo se activa en ese iframe. Manda los
  controles como pedidos propios de la página, con el token en la cabecera `X-Admin-Token`
  (la cookie de sesión no llega a un iframe dentro de `file://`). Recibe el tono del motor,
  lo ubica en el reloj de la canción (`pitch-clock.js`) y alimenta el puntaje sin abrir el
  micrófono del navegador.
- **Motor** (`webos/engine`): ver su [README](../webos/engine/README.md) y
  [PROTOCOL.md](../webos/engine/PROTOCOL.md). Lo arranca y detiene
  `webos/tv/otr-mic.sh`. Sin el latido de la app se silencia a los 4 s y termina a los 30 s.
- **Copias en la tele** (`webos/tv/otr-files.py`, con el Python de la tele): la app le pasa
  las próximas 5 canciones (la que suena y la cola) que se pueden tocar tal cual
  (`/api/tv/prefetch`), las baja una por una a `/media/developer/otr-cache`, borra las que
  ya se cantaron y se las sirve a la página en `127.0.0.1:47831`. Guarda hasta 200 MB y deja
  siempre 150 MB libres (esa partición es la de las apps). Las canciones con otro tono,
  normalización de volumen o un formato que la tele no toca siguen por streaming, igual
  que si la copia falla.

## Desarrollo

```bash
cd webos
npm ci
npm test                 # unitarias
npm run build            # dist/app
npm run test:browser     # la app compilada contra un servidor falso y el motor real
npm run preview          # http://127.0.0.1:5199 en un navegador de escritorio
cd engine && make test   # el motor: C con sanitizers y pruebas de Node
sh engine/docker-build.sh  # binarios ARM estáticos para la tele
npm run package          # el IPK en dist/
```

Publicar: subir la versión en `webos/appinfo.json` y `webos/package.json`; al llegar a
`karaoke-ai`, `.github/workflows/webos.yml` prueba, compila, crea el release
`webos-v<versión>` y actualiza el manifest del feed (release fijo `webos-feed`).
