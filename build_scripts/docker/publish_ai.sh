#!/bin/bash
# Builds the Off the Record image (linux/amd64, see Dockerfile.ai) and pushes it
# to GHCR as :latest and :<date>. Run from the project root after logging in:
#   gh auth refresh -h github.com -s write:packages
#   gh auth token | docker login ghcr.io -u sebastianov92 --password-stdin
set -e

IMAGE=ghcr.io/sebastianov92/off-the-record
STAMP=$(date +%Y.%m.%d)

docker buildx build --platform linux/amd64 -f build_scripts/docker/Dockerfile.ai . \
  -t "$IMAGE:latest" -t "$IMAGE:$STAMP" --push "$@"

echo "Pushed $IMAGE:latest and $IMAGE:$STAMP"
