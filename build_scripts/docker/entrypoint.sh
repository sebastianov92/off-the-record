#!/bin/sh
# Docker creates a missing bind-mount folder owned by root (CasaOS does this for
# /DATA/AppData), and the app user could then not write songs or settings. Starts
# as root only to hand such folders to that user, then drops to it.
set -e

if [ "$(id -u)" = 0 ]; then
  for dir in /app/pikaraoke-songs /home/pikaraoke/.pikaraoke; do
    if [ "$(stat -c %u "$dir")" != 1000 ]; then
      chown -R pikaraoke:pikaraoke "$dir"
    fi
  done
  exec setpriv --reuid=pikaraoke --regid=pikaraoke --init-groups \
    pikaraoke -d /app/pikaraoke-songs/ --headless "$@"
fi
exec pikaraoke -d /app/pikaraoke-songs/ --headless "$@"
