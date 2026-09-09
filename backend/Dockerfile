FROM python:3.14-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY requirements.txt ./requirements.txt
RUN pip wheel --no-cache-dir --wheel-dir /wheels --requirement requirements.txt

FROM python:3.14-slim AS runner

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

RUN groupadd --system --gid 10001 survey \
    && useradd --system --uid 10001 --gid survey --home-dir /app survey
COPY requirements.txt ./requirements.txt
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels --requirement requirements.txt \
    && rm -rf /wheels
COPY --chown=survey:survey alembic.ini ./alembic.ini
COPY --chown=survey:survey alembic ./alembic
COPY --chown=survey:survey app ./app
COPY --chown=survey:survey docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 ./docker-entrypoint.sh

USER survey
EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
