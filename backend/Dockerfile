# syntax=docker/dockerfile:1.7
#
# Production image for the pulse backend.
#
# Two stages keep the runtime layer slim:
#   1. ``builder`` installs the toolchain + libpq headers and builds a
#      standalone virtualenv at /opt/venv from requirements.txt.
#   2. ``runtime`` copies that venv into a fresh ``python:3.12-slim``
#      image with only libpq5 (the runtime dep for psycopg) so the final
#      image stays small and free of compilers.
#
# Workers are pinned to 1 on purpose: rate limiting
# (app/middleware/rate_limit.py), budgeting (app/middleware/budget.py),
# and default in-memory LangGraph checkpoint/store are process-local unless
# replaced with shared backends.
#
# Raising --workers above 1 needs Redis-backed middleware: set
# RATE_LIMIT_BACKEND=redis, BUDGET_BACKEND=redis, IDEMPOTENCY_BACKEND=redis,
# and REDIS_URI (same pattern as backend/docker-compose.yml). Without that,
# per-worker state diverges.
#
# Still prefer multiple containers plus sticky routing unless the full Redis
# wiring (and durable checkpointing where required) is intentional.

# -------- Stage 1: build the venv --------
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# build-essential + libpq-dev are required to compile psycopg's C
# extension; they are intentionally absent from the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /build

COPY requirements.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt


# -------- Stage 2: lean runtime --------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

# libpq5 is the runtime shared library psycopg links against; we do
# not ship the -dev headers or build-essential into the final image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Non-root account for the server process.
RUN useradd --system --uid 1000 --create-home --home-dir /home/app --shell /usr/sbin/nologin app

WORKDIR /app

# Copy the prebuilt venv from the builder stage.
COPY --from=builder /opt/venv /opt/venv

# Copy application source. Tests/docs/CI artifacts are excluded via
# .dockerignore (see repo root) so they don't bloat the image.
COPY app ./app

RUN chown -R app:app /app
USER app

EXPOSE 8000

# Probe /health without a curl/wget dependency.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status == 200 else 1)" || exit 1

# --workers 1: see header for Redis middleware env vars before raising.
# --proxy-headers + --forwarded-allow-ips=* trust X-Forwarded-* from Fly/Render/ECS
# load balancers so request.client and request.url.scheme reflect the real caller.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
