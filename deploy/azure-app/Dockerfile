# TimePitch web app on Azure Container Apps (TP255).
# The image reuses the runtime that already serves the public demo, at the same absolute paths, so nothing is
# recompiled: the release (backend venv, web/dist, TouchLines bundle), the self-contained GRF environment (private
# glibc loader + conda env + native engine) and the demo recordings. Build context = a staging folder prepared by
# build-context.sh on the server; this Dockerfile and entrypoint.sh are copied into it.
FROM debian:trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs ca-certificates media-types \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1000 ignacio && useradd -u 1000 -g 1000 -m -d /home/ignacio -s /usr/sbin/nologin ignacio

COPY --chown=1000:1000 root/ /
COPY --chmod=755 entrypoint.sh /usr/local/bin/timepitch-entrypoint

USER 1000
WORKDIR /home/ignacio/.local/share/timepitch/preview/releases/tp109-two-modes
EXPOSE 8078
ENTRYPOINT ["/usr/local/bin/timepitch-entrypoint"]
