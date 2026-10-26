#!/bin/sh
# Starts and stops otr-mic, Off the Record's microphone engine, on the TV. The
# app runs it as root through Homebrew Channel's exec.
#
#   start [engine options]  returns at once; the engine runs on in the background
#   run [engine options]    (internal) holds the lock, sets the sound mode, runs it
#   stop                    stops the engine; the sound mode goes back
#   status                  JSON: running, pid, saved sound mode
#
# Through the TV speakers it switches LG's sound mode to "game", the ADSP's
# shortest path (mic to ear through hw:0,7: ~70 ms instead of ~120), and puts the
# singer's own mode back afterwards, only if nobody changed it meanwhile. A mode
# saved by a run that crashed is put back the next time.
APP_DIR=$(cd "$(dirname "$0")" && pwd)
SELF="$APP_DIR/$(basename "$0")"
TMP=${OTR_TMP:-/tmp}
LOCK="$TMP/otr-mic.lock"
PIDFILE="$TMP/otr-mic.pid"
SAVED="$TMP/otr-mic.soundmode"
LOG="$TMP/otr-mic.log"
LUNA=${OTR_LUNA:-/usr/bin/luna-send}

# luna-send waits for one reply with -n on webOS 24 and earlier, -t on 25 and 26.
luna() {
  case "$(cat /etc/starfish-release 2>/dev/null)" in
    *" 10."* | *" 11."*) flag=-t ;;
    *) flag=-n ;;
  esac
  "$LUNA" $flag 1 "$@" 2>/dev/null
}

sound_mode() {
  luna luna://com.webos.settingsservice/getSystemSettings '{"category":"sound","keys":["soundMode"]}' |
    sed -n 's/.*"soundMode"[^"]*"\([^"]*\)".*/\1/p'
}

set_sound_mode() {
  luna luna://com.webos.settingsservice/setSystemSettings "{\"category\":\"sound\",\"settings\":{\"soundMode\":\"$1\"}}" >/dev/null
}

# Put the saved mode back, unless the singer chose another one meanwhile.
restore_sound_mode() {
  [ -s "$SAVED" ] || return 0
  saved=$(cat "$SAVED")
  [ "$(sound_mode)" = game ] && [ "$saved" != game ] && set_sound_mode "$saved"
  rm -f "$SAVED"
}

engine_binary() {
  [ -n "$OTR_BIN" ] && { echo "$OTR_BIN"; return; }
  case "$(uname -m)" in
    aarch64 | arm64) for b in otr-mic-aarch64 otr-mic-armv7l; do [ -x "$APP_DIR/bin/$b" ] && { echo "$APP_DIR/bin/$b"; return; }; done ;;
    *) [ -x "$APP_DIR/bin/otr-mic-$(uname -m)" ] && { echo "$APP_DIR/bin/otr-mic-$(uname -m)"; return; } ;;
  esac
  for b in "$APP_DIR"/bin/otr-mic-*; do [ -x "$b" ] && { echo "$b"; return; }; done
}

running_pid() {
  pid=$(cat "$PIDFILE" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "$pid"
}

trim_log() {
  [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 200000 ] && : >"$LOG"
}

cmd_stop() {
  pid=$(running_pid) || return 0
  kill "$pid" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  kill -9 "$pid" 2>/dev/null
  # The wrapper puts the sound mode back when the engine ends; wait for it.
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    [ -e "$LOCK.held" ] || break
    sleep 0.1
  done
}

cmd_start() {
  [ -n "$OTR_TOKEN" ] || { echo '{"error":"OTR_TOKEN missing"}'; exit 1; }
  bin=$(engine_binary)
  [ -n "$bin" ] || { echo '{"error":"engine missing"}'; exit 1; }
  chmod 755 "$bin" 2>/dev/null
  cmd_stop
  trim_log
  # Detached, with no stdio left open: exec only returns when stdout closes.
  # By full path and through sh: the app may call it relative, and the IPK keeps no exec bit we rely on.
  (OTR_TOKEN="$OTR_TOKEN" sh "$SELF" run "$@" </dev/null >>"$LOG" 2>&1 &)
  echo '{"started":true}'
}

cmd_run() {
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK"
    flock -n 9 || exit 1
  fi
  : >"$LOCK.held"
  restore_sound_mode
  output=tv
  prev=
  for arg in "$@"; do
    [ "$prev" = --output ] && output=$arg
    prev=$arg
  done
  if [ "$output" = tv ]; then
    mode=$(sound_mode)
    if [ -n "$mode" ] && [ "$mode" != game ]; then
      echo "$mode" >"$SAVED"
      set_sound_mode game
    fi
  fi
  echo "$(date) start $*"
  "$(engine_binary)" run "$@" &
  echo $! >"$PIDFILE"
  wait $!
  echo "$(date) engine ended ($?)"
  rm -f "$PIDFILE"
  restore_sound_mode
  rm -f "$LOCK.held"
}

cmd_status() {
  pid=$(running_pid)
  printf '{"running":%s,"pid":%s,"savedSoundMode":"%s"}\n' "$([ -n "$pid" ] && echo true || echo false)" \
    "${pid:-null}" "$(cat "$SAVED" 2>/dev/null)"
}

case "$1" in
  start) shift; cmd_start "$@" ;;
  run) shift; cmd_run "$@" ;;
  stop) cmd_stop; echo '{"stopped":true}' ;;
  status) cmd_status ;;
  *) echo "usage: $0 start|stop|status [engine options]" >&2; exit 1 ;;
esac
