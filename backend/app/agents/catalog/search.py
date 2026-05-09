"""``search-agent`` -- embedding-based rerank for the v2.1 streaming surface.

The v1 ``/api/ai/search`` shim in :mod:`app.routers.ai` calls
:func:`polish_search` directly (line 679) and looks up the chat model via
``runtime.get("search-agent").chat_model``.  Both paths must remain stable;
``SearchRanking`` and ``polish_search`` are therefore kept unchanged.

The v2.1 graph adds a real interrupt → embed → rank → polish flow:

1. ``fetch_candidates`` — interrupts to the FE to collect ``{id, text}``
   candidates for the query + kind (tasks or projects).
2. ``rank`` — embeds the query and every candidate text via
   :func:`app.tools.be_tools.embed`, scores by cosine similarity via
   :func:`app.tools.be_tools.embedding_neighbors`, and builds a deterministic
   ``{ids, rationale}`` so the polish step has a safe fallback.
3. ``polish`` — calls :func:`polish_search` to ask the LLM to reorder the
   top candidates; emits ``{"kind": "usage", ...}`` so the FE budget display
   stays accurate.
4. ``emit`` — emits ``{"kind": "suggestion", "surface": "search", ...}``
   and appends a final :class:`~langchain_core.messages.AIMessage` so the
   SSE ``messages`` channel also surfaces the ranking.

Status is ``"active"`` once the graph is wired; the v1 shim continues to
work unchanged via :func:`polish_search`.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore
from langgraph.types import interrupt
from pydantic import BaseModel, Field

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.catalog._schemas import (
    EXPANDED_TERMS_MAX,
    SEARCH_IDS_MAX,
    SEARCH_RATIONALE_MAX,
)
from app.agents.catalog._shared import (
    cap_polished_text,
    filter_to_allowed_ids,
)
from app.agents.llm import is_stub_model  # noqa: F401 -- re-exported for test patching
from app.agents.polish import PolishStep
from app.agents.registry import registry
from app.agents.state import SearchState
from app.tools import be_tools
from app.tools.fe_tool_schemas import interrupt_payload
from app.tools.redaction import redact, redact_dict

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# v1-compatible semantic search baseline (ported from v1_engine.py).
# The ``rank`` node uses this when ``ranking`` is not pre-populated so the
# route no longer needs to pre-call v1_engine.semantic_search.
# ---------------------------------------------------------------------------

import re as _re_search  # noqa: E402

_SEARCH_TOKEN_RE = _re_search.compile(r"[A-Za-z0-9]+")


def _search_tokens(text: str) -> list[str]:
    return [m.group(0).lower() for m in _SEARCH_TOKEN_RE.finditer(text or "")]


def _search_token_set(text: str) -> set[str]:
    return set(_search_tokens(text))


def _search_jaccard(a: set[str], b: set[str]) -> float:
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def semantic_search(
    kind: str,
    query: str,
    context: dict[str, Any],
) -> dict[str, Any]:
    """Return an ``ISearchResult`` ranking matching ids by Jaccard.

    Byte-identical to :func:`app.services.v1_engine.semantic_search`.
    """
    query_tokens = _search_token_set(query)
    if kind == "tasks":
        items = context.get("tasks") or []
        searchables = [
            (
                t.get("_id"),
                _search_token_set(
                    " ".join(
                        str(t.get(field) or "")
                        for field in ("taskName", "note", "type", "epic")
                    )
                ),
            )
            for t in items
            if isinstance(t, dict) and isinstance(t.get("_id"), str)
        ]
    else:
        items = context.get("projects") or []
        searchables = [
            (
                p.get("_id"),
                _search_token_set(
                    " ".join(
                        str(p.get(field) or "")
                        for field in (
                            "projectName",
                            "organization",
                            "organisation",
                            "managerId",
                            "manager",
                        )
                    )
                ),
            )
            for p in items
            if isinstance(p, dict) and isinstance(p.get("_id"), str)
        ]
    scored = [(id_, _search_jaccard(query_tokens, tokens)) for id_, tokens in searchables]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    matched = [id_ for id_, score in scored if score > 0.0]
    return {
        "ids": matched[:10],
        "rationale": (
            f"Ranked by keyword overlap with the query (top {len(matched[:10])})."
            if matched
            else "No matches; try broader keywords."
        ),
    }


class SearchRanking(BaseModel):
    """Typed schema the LLM fills via ``with_structured_output``.

    ``ids`` is bounded to 10 entries to match the v1 shim's existing
    ``ids[:10]`` cap; oversized rankings would be silently truncated by
    the FE consumer in any case. ``rationale`` is a one-line, <=240-char
    explanation -- long enough to name the ranking factors without
    ballooning the response payload.

    ``expanded_terms`` is an optional list of query expansion synonyms
    the LLM can return. If the LLM does not populate it the field is
    omitted from the payload (the FE treats absent as empty).
    """

    ids: list[str] = Field(
        default_factory=list,
        max_length=SEARCH_IDS_MAX,
        description=(
            "Ranked task or project ids, most relevant first. Subset of "
            "the candidate list; never invent ids."
        ),
    )
    rationale: str = Field(
        default="",
        max_length=SEARCH_RATIONALE_MAX,
        description=(
            "Single-line, <=240-character explanation naming the ranking "
            "factors that drove the order."
        ),
    )
    expanded_terms: list[str] = Field(
        default_factory=list,
        max_length=EXPANDED_TERMS_MAX,
        description=(
            "Query expansion terms: synonyms or related keywords the model "
            "used to broaden the search. Leave empty if none were needed."
        ),
    )


# ---------------------------------------------------------------------------
# Cosine-similarity → strength bucketing
# ---------------------------------------------------------------------------

# Thresholds calibrated for unit-normalised (L2) vectors from a real
# text-embedding model. A cosine score of 0.75+ means the two pieces of
# text share substantial semantic content ("strong" match); 0.50–0.75
# indicates topical overlap but possible synonym drift ("moderate"); and
# below 0.50 the match is speculative or only surface-level ("weak").
# For the deterministic SHA-256 stub embedder scores cluster in the
# 0.20–0.60 range due to its low (16-dim) capacity, so most stub results
# will land in "weak" or "moderate" — that is expected and acceptable.
_STRENGTH_STRONG: float = 0.75
_STRENGTH_MODERATE: float = 0.50


def _score_to_strength(score: float) -> str:
    """Map a cosine similarity score to a FE strength label."""
    if score >= _STRENGTH_STRONG:
        return "strong"
    if score >= _STRENGTH_MODERATE:
        return "moderate"
    return "weak"


def _build_matches(ids: list[str], score_map: dict[str, float]) -> list[dict[str, Any]]:
    """Return a ``[{id, strength}]`` list aligned with ``ids``.

    Each entry's strength corresponds to the cosine score in
    ``score_map``; ids absent from the map (shouldn't happen, but
    defensive) are assigned ``"weak"``.
    """
    return [
        {"id": id_, "strength": _score_to_strength(score_map.get(id_, 0.0))}
        for id_ in ids
    ]


def _strength_to_score(strength: str) -> float:
    """Return the lower threshold for a strength label.

    Used when re-building a score_map from an existing ``matches`` list so
    that after LLM reranking the per-id strength can be preserved.
    """
    if strength == "strong":
        return _STRENGTH_STRONG
    if strength == "moderate":
        return _STRENGTH_MODERATE
    return 0.0


def _build_search_prompt(state: dict[str, Any]) -> str:
    candidates = state["_candidates"]
    query = state["_query"]
    safe_candidates = redact_dict(candidates[:30])
    safe_query = redact(query)[0] if isinstance(query, str) else query
    return (
        "You are re-ranking search results for a Jira-style project tool. "
        "Pick up to 10 of the candidate ids that best match the query, "
        "ordered most to least relevant. Use only ids that appear in the "
        "candidate list; never invent new ids. Return JSON matching the "
        "schema, including a single-line rationale (<=240 chars) naming "
        "the ranking factors.\n\n"
        f"Query: {safe_query}\n"
        f"Candidates: {json.dumps(safe_candidates)}"
    )


def _merge_search(state: dict[str, Any], parsed: Any) -> dict[str, Any]:
    deterministic = state["_deterministic"]
    candidates = state["_candidates"]
    candidate_ids = {
        c.get("id")
        for c in candidates
        if isinstance(c, dict) and isinstance(c.get("id"), str)
    }
    if not isinstance(parsed, SearchRanking):
        return {"_result": parsed}  # fallback value (dict)
    polished_ids = filter_to_allowed_ids(parsed.ids, candidate_ids)
    if not polished_ids:
        return {"_result": deterministic}
    rationale = cap_polished_text(
        parsed.rationale,
        max_chars=SEARCH_RATIONALE_MAX,
        fallback=deterministic.get("rationale", ""),
    )
    score_map: dict[str, float] = dict(deterministic.get("_score_map") or {})
    if not score_map:
        score_map = {
            m["id"]: _strength_to_score(m["strength"])
            for m in (deterministic.get("matches") or [])
            if isinstance(m, dict)
        }
    polished_matches = _build_matches(polished_ids[:SEARCH_IDS_MAX], score_map)
    polished: dict[str, Any] = {
        **deterministic,
        "ids": polished_ids[:SEARCH_IDS_MAX],
        "rationale": rationale,
        "matches": polished_matches,
    }
    expanded = [
        t for t in (parsed.expanded_terms or []) if isinstance(t, str) and t.strip()
    ]
    if expanded:
        polished["expandedTerms"] = expanded
    return {"_result": polished}


_search_step: PolishStep[SearchRanking] = PolishStep(
    prompt_fn=_build_search_prompt,
    schema=SearchRanking,
    fallback_fn=lambda state: state["_deterministic"],
    merge_fn=_merge_search,
)


async def _polish_search(
    model: BaseChatModel,
    deterministic: dict[str, Any],
    query: str,
    candidates: list[dict[str, Any]],
) -> tuple[dict[str, Any], Any, int, int]:
    """LLM-rerank deterministic search hits; deterministic fallback on stub.

    Returns ``(result, raw_message, tokens_in, tokens_out)``.
    ``raw_message`` is the underlying ``AIMessage`` with ``usage_metadata``
    populated; callers should include it in the node's ``messages`` return
    value so budget tracking can find the token counts.  It is ``None`` on
    the stub path, the empty-candidates short-circuit, or when the call fails.

    ``candidates`` is a list of ``{id, text}`` dicts the v1 shim derived
    from ``context.tasks`` / ``context.projects``. The ranking the LLM
    returns is intersected with these so a hallucinated id never reaches
    the FE -- the FE validator does the same check, but doing it
    server-side keeps the contract tight and avoids round-trips to
    discover that an id was bogus. A blank rationale or any structured-
    output failure preserves the deterministic ``ids`` + ``rationale``
    so the FE layout stays byte-identical with the no-key path.
    """
    # Empty candidate list means the deterministic ranker found nothing
    # to score; the LLM has no useful work and would hallucinate ids.
    if not candidates:
        return deterministic, None, 0, 0
    _state = {"_deterministic": deterministic, "_query": query, "_candidates": candidates}
    update, tokens_in, tokens_out = await _search_step.run(_state, model)
    raw_msg: Optional[AIMessage] = (
        AIMessage(
            content="",
            usage_metadata={
                "input_tokens": tokens_in,
                "output_tokens": tokens_out,
                "total_tokens": tokens_in + tokens_out,
            },
        )
        if (tokens_in or tokens_out)
        else None
    )
    return update["_result"], raw_msg, tokens_in, tokens_out


async def polish_search(
    model: BaseChatModel,
    deterministic: dict[str, Any],
    query: str,
    candidates: list[dict[str, Any]],
) -> tuple[dict[str, Any], int, int]:
    """Backward-compatible 3-tuple wrapper around :func:`_polish_search`.

    External callers (v1 shim, tests) rely on the 3-tuple
    ``(result, tokens_in, tokens_out)`` signature.  The ``polish`` node
    inside :class:`SearchAgent` calls :func:`_polish_search` directly so it
    can also capture the raw ``AIMessage`` for budget tracking.
    """
    result, _raw_msg, tokens_in, tokens_out = await _polish_search(
        model, deterministic, query, candidates
    )
    return result, tokens_in, tokens_out


class SearchAgent(BaseAgent):
    """Embedding-rerank search agent.  Internal callers use ``_polish_search``
    and ``runtime.get("search-agent").chat_model`` -- both remain stable.

    The v2.1 graph implements:
        START → fetch_candidates → rank → polish → emit → END

    ``fetch_candidates`` raises ``interrupt`` so the FE can supply the
    candidate set from its own local state (avoiding a BE → FE API call
    direction reversal).  The BE embeds query + candidates, scores by cosine
    similarity, calls :func:`polish_search`, and emits the final ranking on
    the ``suggestion`` custom event *and* on the ``messages`` channel.

    ``allowed_autonomy=("suggest",)`` because a search rerank is read-only.
    ``recursion_limit=8`` matches :class:`~app.agents.catalog.task_estimation.TaskEstimationAgent`.
    """

    metadata = AgentMetadata(
        name="search-agent",
        description=(
            "Embedding-based search rerank: interrupt for FE candidate set, "
            "embed query + candidates, rank by cosine similarity, polish with LLM."
        ),
        version="2.1.0",
        tags=("board-copilot", "search"),
        recursion_limit=8,
        status="active",
        rate_limit=(30, 300),
        allowed_autonomy=("suggest",),
        tools=("fe.searchCandidates", "be.embed", "be.embedding_neighbors"),
        redactable_text_fields=("query",),
        redactable_dict_fields=("context",),
        rationale={
            "recursion_limit": (
                "Linear graph (fetch_candidates → rank → polish → emit); "
                "8 leaves headroom for any future expand-then-rerank loop."
            ),
            "rate_limit": (
                "Highest of any agent: search is type-ahead-style and "
                "expected to fire repeatedly within a session."
            ),
            "allowed_autonomy": (
                "Read-only rerank: suggest-only, never plan/auto."
            ),
        },
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        """Compile the v2.1 search graph.

        The chat model is captured at build time (standard catalog pattern)
        so the graph closure holds a single model reference for the lifetime
        of the compiled graph -- identical to how task-estimation-agent works.
        """
        chat_model: BaseChatModel = self.chat_model

        def fetch_candidates(state: SearchState) -> dict[str, Any]:
            """Interrupt to the FE requesting the candidate set.

            The FE knows the current project's tasks/projects; reversing the
            call direction (BE fetching from FE REST) would require auth
            plumbing the FE doesn't expose.  The interrupt pattern is the
            established solution in this codebase (cf. task-estimation-agent's
            ``fetch_similar`` node).

            Short-circuits when ``candidates`` is already on state — mirrors
            :func:`app.agents.catalog._shared.fetch_snapshot_node`.  Lets the
            v1 JSON shim pre-populate from ``projectContext`` /
            ``projectsContext`` and skip the interrupt entirely.
            """
            if state.get("candidates") is not None:
                return {}
            candidates = interrupt(
                interrupt_payload(
                    "fe.searchCandidates",
                    {
                        "project_id": state.get("project_id"),
                        "query": state.get("query") or "",
                        "kind": state.get("kind") or "tasks",
                        "limit": 30,
                    },
                )
            )
            # The FE returns ``{"candidates": [{id, text}, ...]}``;
            # unwrap to the list so downstream nodes don't have to.
            if isinstance(candidates, dict) and "candidates" in candidates:
                candidates = candidates["candidates"]
            return {"candidates": candidates}

        async def rank(state: SearchState) -> dict[str, Any]:
            """Embed query + candidates; rank by cosine similarity.

            Short-circuits when ``ranking`` is already on state -- the v1 shim
            pre-populates it with the ``v1_engine.semantic_search`` result so
            the agent skips embedding-based computation and goes straight to
            ``polish``.

            When the candidate list is empty we skip embedding (no work to do)
            and return ``{ids: [], rationale: "..."}`` so downstream nodes
            have a safe, non-None value to work with.

            ``matches`` is built here from the cosine scores returned by
            :func:`~app.tools.be_tools.embedding_neighbors`; each entry
            carries the corresponding strength bucket so the FE
            ``AiMatchStrengthBadge`` can render a coloured chip per result.
            """
            if state.get("ranking") is not None:
                return {}
            candidates = state.get("candidates") or []
            query = state.get("query") or ""
            n = len(candidates)
            if not candidates:
                return {
                    "ranking": {
                        "ids": [],
                        "matches": [],
                        "rationale": "No candidates returned for this query.",
                    }
                }
            # Embed query and all candidate texts in a single batch where
            # possible; the provider (or stub) normalises to unit vectors.
            # ``embed_async`` offloads the (possibly blocking) provider
            # call to a thread so the event loop stays responsive while
            # ranking large candidate sets against a real OpenAI provider.
            texts = [query] + [c.get("text", "") for c in candidates]
            vectors = await be_tools.embed_async(texts)
            query_vec = vectors[0]
            corpus = [
                (c.get("id", str(idx)), vectors[idx + 1])
                for idx, c in enumerate(candidates)
            ]
            neighbours = be_tools.embedding_neighbors(query_vec, corpus, k=10)
            # Capture both ids and scores; scores drive the strength labels.
            ids = [item_id for item_id, _score in neighbours]
            score_map = {item_id: score for item_id, score in neighbours}
            matches = _build_matches(ids, score_map)
            return {
                "ranking": {
                    "ids": ids,
                    "matches": matches,
                    "rationale": f"Ranked by embedding similarity over {n} candidates.",
                    # Thread the original cosine scores through to ``polish``
                    # so LLM-reranked ids keep their real scores rather than
                    # the bucket floor from ``_strength_to_score``.
                    "_score_map": score_map,
                }
            }

        async def polish(state: SearchState) -> dict[str, Any]:
            """LLM-polish the deterministic ranking."""
            candidates = state.get("candidates") or []
            query = state.get("query") or ""
            deterministic = state.get("ranking") or {"ids": [], "rationale": ""}
            polished, raw_msg_search, _tokens_in, _tokens_out = await _polish_search(
                chat_model, deterministic, query, candidates
            )
            extra_msgs_search = [raw_msg_search] if raw_msg_search is not None else []
            # Strip ``_score_map`` before persisting: it only needs to live
            # across rank → polish and should never reach the checkpointer.
            return {
                "ranking": {k: v for k, v in polished.items() if k != "_score_map"},
                **({"messages": extra_msgs_search} if extra_msgs_search else {}),
            }

        def emit(state: SearchState) -> dict[str, Any]:
            """Return the final ranking as a suggestion event and as an AIMessage.

            Writing the ranking to ``messages`` ensures that callers on the
            ``/invoke`` path (which do not receive SSE custom events) can still
            read the ranking from the returned state -- consistent with how
            task-estimation-agent surfaces its payload on the messages channel.

            ``_score_map`` is stripped here so it never reaches the FE wire
            contract; it is an internal implementation detail used only by
            the ``polish`` node.
            """
            ranking_raw = state.get("ranking") or {"ids": [], "rationale": ""}
            # Strip the internal ``_score_map`` field before serialising.
            ranking = {k: v for k, v in ranking_raw.items() if k != "_score_map"}
            return {
                "messages": [AIMessage(content=json.dumps(ranking))],
                "events": [
                    {
                        "kind": "suggestion",
                        "surface": "search",
                        "payload": ranking,
                    }
                ],
            }

        graph: StateGraph = StateGraph(SearchState)
        graph.add_node("fetch_candidates", fetch_candidates)
        graph.add_node("rank", rank)
        graph.add_node("polish", polish)
        graph.add_node("emit", emit)
        graph.add_edge(START, "fetch_candidates")
        graph.add_edge("fetch_candidates", "rank")
        graph.add_edge("rank", "polish")
        graph.add_edge("polish", "emit")
        graph.add_edge("emit", END)
        return graph.compile(checkpointer=checkpointer, store=store)


registry.register(SearchAgent(), replace=True)
