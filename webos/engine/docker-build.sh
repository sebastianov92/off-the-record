#!/bin/sh
# Builds the static TV binaries in emulated ARM containers (Alpine: musl, so the
# binary needs nothing from the TV's own libraries). Output: dist/otr-mic-armv7l
# and dist/otr-mic-aarch64. Needs Docker with ARM emulation (Docker Desktop has
# it; CI uses setup-qemu-action).
set -e
cd "$(dirname "$0")"
for platform in linux/arm/v7 linux/arm64; do
  docker run --rm --platform "$platform" -v "$PWD:/src" -w /src alpine:3.20 \
    sh -c 'apk add --no-cache build-base linux-headers >/dev/null && make linux ARCH=$(uname -m)'
done
ls -la dist
