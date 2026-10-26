#!/bin/sh
# Starts and stops otr-files (otr-files.py), the TV's copies of the next songs. The
# app runs it as root through Homebrew Channel's exec.
#
#   start [options]   returns at once; it runs on in the background
#   stop
#
APP_DIR=$(cd "$(dirname "$0")" && pwd)
TMP=${OTR_TMP:-/tmp}
PIDFILE="$TMP/otr-files.pid"
LOG="$TMP/otr-files.log"
PYTHON=${OTR_PYTHON:-python3}

cmd_stop() {
  pid=$(cat "$PIDFILE" 2>/dev/null)
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
  rm -f "$PIDFILE"
}

cmd_start() {
  [ -n "$OTR_TOKEN" ] || { echo '{"error":"OTR_TOKEN missing"}'; exit 1; }
  command -v "$PYTHON" >/dev/null 2>&1 || { echo '{"error":"python3 missing"}'; exit 1; }
  cmd_stop
  [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 100000 ] && : >"$LOG"
  # Detached, with no stdio left open: exec only returns when stdout closes.
  (OTR_TOKEN="$OTR_TOKEN" "$PYTHON" "$APP_DIR/otr-files.py" "$@" </dev/null >>"$LOG" 2>&1 &
    echo $! >"$PIDFILE")
  echo '{"started":true}'
}

case "$1" in
  start) shift; cmd_start "$@" ;;
  stop) cmd_stop ;;
  *) echo "usage: $0 start [options] | stop" >&2; exit 2 ;;
esac
