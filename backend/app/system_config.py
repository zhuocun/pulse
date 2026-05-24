"""Persisted process-shared configuration backed by the application DB.

This module owns the small ``system_config`` collection (Mongo) that
the FastAPI lifespan reads to bootstrap a stable JWT secret without
requiring the operator to set the ``UUID`` env var. Persisting the
secret in the same store the app already needs at boot (Mongo) drops
one knob from the operator-required checklist: a Vercel project that
sets ``MONGO_URI`` and one provider key is now sufficient.

Race-safety: two cold-start workers may hit the read-then-create path
concurrently. The implementation uses an idempotent ``$setOnInsert``
upsert and re-reads after the upsert so both workers converge on the
single document that actually won the race rather than each writing
their own random value (which would mean tokens minted by worker A
fail verification on worker B).

The ``repository`` argument is deliberately the generic
:class:`app.repositories.Repository` Protocol -- it is satisfied by
both :class:`MongoRepository` (production) and ``FakeStore`` (tests)
so this module needs no special test scaffolding.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
import secrets
from typing import Any, Tuple

logger = logging.getLogger(__name__)


# Canonical collection name. Kept here (not in ``database.py``) because
# the document layout is owned by this module and Mongo creates the
# collection lazily on first write -- no schema migration is required.
SYSTEM_CONFIG = "system_config"

# Stable document id for the JWT-secret row. Using a sentinel string
# (not an ObjectId) makes the upsert path explicit: both workers race
# for the same ``_id`` and Mongo's primary-key uniqueness guarantees
# exactly one insert succeeds.
_JWT_SECRET_DOC_ID = "jwt_secret"


def load_or_create_jwt_secret(
    repository: Any,
    *,
    length_bytes: int = 32,
) -> Tuple[str, str]:
    """Return ``(secret_hex, source)`` for the persisted JWT secret.

    ``source`` is ``"persisted"`` when an existing row was read and
    ``"generated"`` when this call inserted a new row. The lifespan
    surfaces both as the same operator-visible source (the secret is
    persisted either way); the distinction is useful for log messages
    and the readiness endpoint.

    The implementation is intentionally a read -> upsert -> re-read so
    a concurrent insert from another worker (or another process on the
    same cluster during a rolling deploy) does not overwrite the
    already-persisted value. The ``$setOnInsert`` operator guarantees
    the existing row is left untouched.
    """

    existing = _find_secret_document(repository)
    if existing is not None:
        value = _extract_secret_value(existing)
        if value is not None:
            return value, "persisted"

    new_secret = secrets.token_hex(length_bytes)
    _upsert_secret_document(repository, new_secret)

    # Re-read so a concurrent insert wins deterministically -- if
    # another worker beat us to the insert the upsert was a no-op and
    # the next read returns *their* secret, not ours.
    after = _find_secret_document(repository)
    if after is not None:
        value = _extract_secret_value(after)
        if value is not None:
            # If the re-read returned the same secret we just minted,
            # this worker won the race; otherwise some peer did and we
            # silently adopt the persisted value.
            source = "generated" if value == new_secret else "persisted"
            return value, source

    # The upsert path could not surface the value; this should never
    # happen against a working DB, but the lifespan needs *some* secret
    # to keep boot moving and we prefer the freshly-minted value to
    # raising here (the lifespan layer decides whether to escalate).
    logger.warning(
        "system_config.%s upsert succeeded but re-read returned no value; "
        "using the freshly-minted secret without persistence confirmation.",
        _JWT_SECRET_DOC_ID,
    )
    return new_secret, "generated"


def _find_secret_document(repository: Any) -> Any:
    """Read the JWT-secret row via the repository ``find_one`` surface.

    Wrapped in a defensive try/except because both Mongo (transient
    network errors) and ``FakeStore`` (already-present collection but
    no matching row) can surface differently; the lifespan treats a
    failed read as "no persisted secret" and falls back to its next
    resolution branch.
    """

    try:
        return repository.find_one(SYSTEM_CONFIG, {"_id": _JWT_SECRET_DOC_ID})
    except Exception:  # noqa: BLE001 -- defensive boundary on storage probe
        logger.exception(
            "system_config.%s read failed; treating as missing.",
            _JWT_SECRET_DOC_ID,
        )
        return None


def _upsert_secret_document(repository: Any, secret_hex: str) -> None:
    """Insert the JWT-secret row, tolerating the "already exists" race.

    The MongoRepository implementation goes through pymongo's collection
    handle when a ``$setOnInsert`` upsert is available; the FakeStore
    has no such mechanism, so we fall back to a plain ``insert_one``
    after re-checking the row is absent. Either path is safe because
    the surrounding ``load_or_create_jwt_secret`` re-reads the row
    afterwards and adopts whichever value survived.
    """

    document = {
        "_id": _JWT_SECRET_DOC_ID,
        "value": secret_hex,
        "createdAt": datetime.now(timezone.utc),
    }

    upsert = getattr(repository, "upsert_system_config", None)
    if callable(upsert):
        try:
            upsert(_JWT_SECRET_DOC_ID, document)
            return
        except Exception:  # noqa: BLE001 -- fall through to insert_one below
            logger.exception(
                "system_config upsert helper failed; falling back to insert_one."
            )

    try:
        repository.insert_one(SYSTEM_CONFIG, document)
    except Exception:  # noqa: BLE001 -- duplicate-key on concurrent insert is fine
        logger.debug(
            "system_config.%s insert raced with a peer; relying on re-read.",
            _JWT_SECRET_DOC_ID,
        )


def _extract_secret_value(document: Any) -> str | None:
    """Pull the ``value`` field off the stored row, ignoring empty strings."""

    if not isinstance(document, dict):
        return None
    value = document.get("value")
    if isinstance(value, str) and value:
        return value
    return None
