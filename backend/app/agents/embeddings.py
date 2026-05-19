"""Embeddings provider plumbing (mirror of :mod:`app.agents.llm`).

Until this module landed, ``app/tools/be_tools.embed`` returned
SHA-256-derived deterministic floats and ``embedding_neighbors`` did
dot products on them; the result was a stable-but-meaningless
similarity score whose only consumer was ``task-estimation-agent``'s
``fetch_embeddings`` node. Switching to a real provider lets that
agent score neighbour tasks against a learned semantic space, closing
one of the two AI gaps the original architecture review flagged.

OpenAI is the only supported real provider -- Anthropic has no
embeddings API. Selection mirrors the chat-model factory: ``auto``
inspects ``OPENAI_API_KEY`` and falls back to the deterministic stub
when no key is set or the optional extra is missing. The stub keeps
the tests hermetic and lets a deployment ship without an embeddings
key (``task-estimation-agent`` then falls back to its existing
deterministic neighbour scoring path).
"""

from __future__ import annotations

from dataclasses import dataclass
import importlib
import logging
from typing import Optional

from langchain_core.embeddings import Embeddings

from app.config import Settings, settings as default_settings

logger = logging.getLogger(__name__)

PROVIDER_AUTO = "auto"
PROVIDER_OPENAI = "openai"
PROVIDER_STUB = "stub"

SUPPORTED_PROVIDERS = frozenset({PROVIDER_AUTO, PROVIDER_OPENAI, PROVIDER_STUB})

DEFAULT_OPENAI_MODEL = "text-embedding-3-small"

# Dimensionality of the deterministic stub vector. ``be_tools.embed``
# defaults to 16-float L2-normalised vectors; we pin the same width on
# the OpenAI side via the ``dimensions=N`` request parameter so a
# runtime swap from stub -> real provider does not change the shape
# every downstream call site (``embedding_neighbors``, the task-
# estimation agent's score map) was wired against.
STUB_EMBEDDING_DIM = 16

# (langchain integration module, pyproject extras name) per provider.
# Only OpenAI for now; an Anthropic embeddings API would slot in here
# without touching the rest of the file.
_PROVIDER_PACKAGES: dict[str, tuple[str, str]] = {
    PROVIDER_OPENAI: ("langchain_openai", "openai"),
}


def _require_integration(provider: str) -> None:
    """Import the langchain integration for ``provider`` or raise.

    Shared between :func:`make_embeddings` (right before instantiating
    the embeddings class) and :func:`assert_embeddings_provider_available`
    (at boot) so the user-facing remediation copy stays consistent.
    """

    package = _PROVIDER_PACKAGES.get(provider)
    if package is None:
        return
    module_name, extra_name = package
    try:
        importlib.import_module(module_name)
    except ImportError as exc:
        dist_name = module_name.replace("_", "-")
        raise RuntimeError(
            f"{dist_name} is not installed but EMBEDDINGS_PROVIDER "
            f"resolved to '{provider}'. Run "
            f'`pip install ".[{extra_name}]"` (or `".[ai]"`) or set '
            "EMBEDDINGS_PROVIDER=stub."
        ) from exc


@dataclass(frozen=True)
class EmbeddingsSpec:
    """Resolved embeddings configuration.

    ``provider`` is one of the concrete providers (never ``"auto"``).
    ``model`` is the provider-specific model id (e.g.
    ``text-embedding-3-small``) or the empty string for the stub.
    ``api_key`` is captured at resolution time so a later env mutation
    does not silently change runtime behaviour.
    """

    provider: str
    model: str
    api_key: str = ""

    @property
    def is_stub(self) -> bool:
        return self.provider == PROVIDER_STUB


def _detect_provider(settings: Settings) -> str:
    """Pick a concrete provider based on env when ``provider=auto``."""

    if settings.openai_api_key:
        return PROVIDER_OPENAI
    return PROVIDER_STUB


def resolve_embeddings_spec(
    *,
    settings: Optional[Settings] = None,
) -> EmbeddingsSpec:
    """Translate :class:`Settings` into an :class:`EmbeddingsSpec`.

    Validates the configured provider, runs auto-detection, and applies
    the provider default for the model id when the operator left it blank.
    """

    cfg = settings if settings is not None else default_settings
    raw = (cfg.embeddings_provider or PROVIDER_AUTO).strip().lower()
    if raw not in SUPPORTED_PROVIDERS:
        raise RuntimeError(
            f"Unsupported EMBEDDINGS_PROVIDER={raw!r}; expected one of "
            + ", ".join(sorted(SUPPORTED_PROVIDERS))
        )
    provider = _detect_provider(cfg) if raw == PROVIDER_AUTO else raw
    if provider == PROVIDER_OPENAI:
        model = cfg.embeddings_model_id or DEFAULT_OPENAI_MODEL
        api_key = cfg.openai_api_key
    else:
        model = cfg.embeddings_model_id or ""
        api_key = ""
    return EmbeddingsSpec(provider=provider, model=model, api_key=api_key)


class _StubEmbeddings(Embeddings):
    """Deterministic SHA-256-derived embeddings for the no-key path.

    Delegates to :func:`app.tools.be_tools.embed` so the byte-for-byte
    output matches what the catalog has shipped since Phase A. Living
    behind the langchain :class:`Embeddings` interface lets the rest of
    the catalog treat the stub and a real provider uniformly -- same
    ``embed_query`` / ``embed_documents`` surface, same vector width,
    same L2-normalised invariant.
    """

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        # Local import keeps :mod:`app.tools.be_tools` free of an
        # ``app.agents`` import cycle (``be_tools.embed`` itself
        # consults this stub via ``make_embeddings`` for the real-
        # provider branch). We call ``_stub_embed`` (the deterministic
        # SHA-256 helper) rather than the public ``embed`` so the stub
        # path stays purely local and is not subject to the provider
        # branch in the public ``embed`` wrapper.
        from app.tools.be_tools import _stub_embed

        return _stub_embed(texts, dim=STUB_EMBEDDING_DIM)

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]


def make_stub_embeddings() -> _StubEmbeddings:
    """Return the deterministic stub directly.

    Mirrors :func:`app.agents.llm.make_stub_chat_model` so callers that
    want the stub explicitly (tests, the deterministic fallback path
    in ``be_tools``) do not have to round-trip through settings.
    """

    return _StubEmbeddings()


def make_embeddings(
    spec: Optional[EmbeddingsSpec] = None,
    *,
    settings: Optional[Settings] = None,
) -> Embeddings:
    """Build an :class:`Embeddings` for ``spec`` (or the resolved default).

    ``spec`` may be passed directly (e.g. by tests) to force a particular
    provider; otherwise the spec is resolved from ``settings`` (or the
    process-wide :data:`app.config.settings` when omitted).

    Real providers raise :class:`RuntimeError` if the matching LangChain
    integration package is not installed -- importing inside the branch
    keeps optional dependencies optional.
    """

    cfg = settings if settings is not None else default_settings
    resolved = spec if spec is not None else resolve_embeddings_spec(settings=cfg)
    _require_integration(resolved.provider)
    if resolved.provider == PROVIDER_OPENAI:
        from langchain_openai import OpenAIEmbeddings

        # Use EMBEDDINGS_DIMENSIONS (default 16) so production can set 512+
        # for real semantic quality without a code change. Stub always uses 16.
        dims = cfg.embeddings_dimensions
        return OpenAIEmbeddings(
            model=resolved.model,
            dimensions=dims,
            api_key=resolved.api_key or None,
        )
    logger.debug("Embeddings factory returning deterministic stub.")
    return make_stub_embeddings()


def assert_embeddings_provider_available(
    spec: Optional[EmbeddingsSpec] = None,
    *,
    settings: Optional[Settings] = None,
) -> None:
    """Fail fast at boot when the configured provider's package is missing.

    ``be_tools.embed`` resolves the provider lazily on its first call,
    so a typo like ``EMBEDDINGS_PROVIDER=openai`` without
    ``langchain-openai`` installed only surfaces when
    ``task-estimation-agent`` reaches its ``fetch_embeddings`` node.
    Calling this from the FastAPI lifespan turns that into a startup
    failure -- operators see the wiring problem in the deploy log
    instead of in user-visible 500s on the SSE stream.

    No-op when the resolved provider is the deterministic stub: the
    stub has no integration package to import and is the documented
    fallback for embeddings-disabled deployments.

    Also logs a WARNING (not a raise) when the resolved provider is
    ``openai`` and the configured dimension differs from
    ``STUB_EMBEDDING_DIM``: if the process previously ran with the stub
    against a Postgres vector store, the existing column may be sized
    for the stub width.  Re-create the store schema before depending on
    the new width.
    """

    cfg = settings if settings is not None else default_settings
    resolved = spec if spec is not None else resolve_embeddings_spec(settings=cfg)
    _require_integration(resolved.provider)
    if resolved.provider == PROVIDER_OPENAI:
        # Always log the active dimension at INFO so operators can spot
        # mismatches in the deploy log without waiting for a query to fail.
        logger.info(
            "Embeddings provider=openai model=%s dimensions=%d",
            resolved.model,
            cfg.embeddings_dimensions,
        )
        if cfg.embeddings_dimensions != STUB_EMBEDDING_DIM:
            logger.warning(
                "Embedding width changed (configured=%d, stub=%d). If you previously "
                "ran with the stub against a Postgres store, the existing vector column "
                "may be sized for the stub width — re-create the store schema before "
                "depending on this width.",
                cfg.embeddings_dimensions,
                STUB_EMBEDDING_DIM,
            )


def is_stub_embeddings(model: object) -> bool:
    """Return ``True`` when ``model`` is the deterministic stub.

    ``be_tools`` uses this as a feature flag: stub -> keep the
    SHA-256-derived deterministic floats; real provider -> route through
    its ``embed_documents`` / ``embed_query``.
    """

    return isinstance(model, _StubEmbeddings)
