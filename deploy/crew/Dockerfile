# TimePitch crew job image (TP233): the crew + crew-cloud dependency groups only, run as non-root.
# Built remotely with `az acr build` from a `git archive` of the commit (no local Docker build):
#   context = repo root of the archive; this file = deploy/crew/Dockerfile.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.29 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
# Locked dependencies first (cached layer), then the package itself, non-editable.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --group crew --group crew-cloud --no-install-project
COPY backend/src ./src
RUN uv sync --frozen --no-dev --group crew --group crew-cloud --no-editable \
    && rm -rf /usr/local/bin/uv /root/.cache \
    && useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin crew

ENV PATH=/app/.venv/bin:$PATH \
    TIMEPITCH_CREW_STORAGE_ACCOUNT=timepitchcrew
USER 10001
# One message per execution; KEDA (azure-queue) starts the next execution.
ENTRYPOINT ["python", "-m", "timepitch.crew", "job"]
