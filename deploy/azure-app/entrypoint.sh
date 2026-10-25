#!/bin/sh
# Container Apps mounts secrets as symlinked files readable by others; the crew code only accepts private regular
# files. Copy them into a 0700 folder, then start the same uvicorn command as the server (listening on all
# interfaces behind the Container Apps ingress).
set -eu
umask 077
SECRETS=/home/ignacio/secrets
mkdir -p "$SECRETS" "${TIMEPITCH_RUNTIME_DIR:-/home/ignacio/.local/share/timepitch/preview/runtime}"
if [ -d /mnt/secrets ]; then
  for name in crew-envelope crew-queue-sas crew-reports-sas; do
    if [ -e "/mnt/secrets/$name" ]; then cat "/mnt/secrets/$name" > "$SECRETS/$name"; fi
  done
fi
# Trust X-Forwarded-For only from the ingress proxy's private addresses: with '*' uvicorn took the leftmost entry,
# which the visitor writes (TP257). The visitor IP is then the rightmost entry the ingress appended.
exec backend/.venv/bin/python -m uvicorn timepitch.app:create_app --factory --host 0.0.0.0 --port 8078 \
  --proxy-headers --forwarded-allow-ips='127.0.0.1,::1,10.0.0.0/8,100.64.0.0/10,172.16.0.0/12,192.168.0.0/16' \
  --no-server-header
