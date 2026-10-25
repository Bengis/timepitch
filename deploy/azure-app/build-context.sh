#!/bin/sh
# Prepare the image build context on the server from the live runtime (run as the service user).
# Usage: sh build-context.sh <output dir>
set -eu
D=$(dirname "$0")
OUT=${1:?output dir}
B=$HOME/.local/share/timepitch
rm -rf "$OUT"; mkdir -p "$OUT/root$B/preview"
cp -a "$B/grf-ubuntu-probe-20261018-4da58c" "$OUT/root$B/"
mkdir -p "$OUT/root$B/preview/releases"
rsync -a --exclude="*.prev-*" "$B/preview/releases/tp109-two-modes" "$OUT/root$B/preview/releases/"
cp -a "$B/preview/replays" "$OUT/root$B/preview/"
cp "$D/Dockerfile" "$D/entrypoint.sh" "$OUT/"
du -sh "$OUT/root"
