"""``PolishStep`` -- declarative abstraction for LLM polish passes.

Every catalog agent runs a small "polish" step: send a prompt derived from
deterministic state to the LLM via ``with_structured_output``, parse the
typed response, merge the polished fields back onto the deterministic
baseline, and fall back cleanly when the model is the stub or when the
provider raises / returns a malformed response.

Before this module, each agent duplicated a four-cell try/except + unpack +
token-extract dance.  :class:`PolishStep` extracts that dance into a single
place so agents declare *what* to polish rather than *how*.

Usage
-----

1. Declare a step at module level (or inside ``build()``)::

       step = PolishStep(
           prompt_fn=_build_prompt,
           schema=MySchema,
           fallback_fn=lambda state: state["deterministic_value"],
           merge_fn=lambda state, polished: {"field": polished},
           redact=redact_dict,   # optional
       )

   When the polish result is a single capped string field you can use the
   ``cap_field`` shorthand instead of writing a ``merge_fn``::

       step = PolishStep(
           prompt_fn=_build_prompt,
           schema=MySchema,
           fallback_fn=lambda state: state["_deterministic"],
           cap_field=("headline", HEADLINE_MAX),
       )

   ``cap_field=(field_name, max_chars)`` auto-generates a ``merge_fn`` that:
   (a) extracts ``parsed.<field_name>`` from the parsed schema instance,
   (b) strips, takes the first line, and caps at ``max_chars`` via
   :func:`cap_polished_text`, using ``state["_deterministic"]`` as the
   fallback, and (c) returns ``{"_result": capped_value}``.  The fallback
   path also returns ``{"_result": state["_deterministic"]}``.

2. Call it inside a node::

       async def my_node(state):
           update, tokens_in, tokens_out = await step.run(state, model)
           return update

The four-cell matrix (stub / real-success / real-parse-error / real-raise)
is handled inside :meth:`PolishStep.run`; callers never repeat it.

Design constraints
------------------
- The model is passed *into* ``run(state, model)`` rather than captured on
  the instance — this is a stepping stone for Phase 4 where the model will
  live on context.
- Existing ``structured_llm_call`` in ``_shared.py`` and all backward-
  compatible ``polish_*`` wrappers in the catalog modules are left intact
  so the Phase 3 migration is additive and existing tests keep passing.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Generic, Optional, TypeVar

from pydantic import BaseModel

logger = logging.getLogger(__name__)

_SchemaT = TypeVar("_SchemaT", bound=BaseModel)


def cap_polished_text(text: Any, *, max_chars: int, fallback: str) -> str:
    """First-line, stripped, length-capped polish output with fallback.

    Five of the six catalog agents collapse a polished string into a
    single line and cap it at ``max_chars`` so the wire shape stays
    predictable.  A blank or non-string result preserves
    ``fallback``: the deterministic baseline is more useful than ``""``.

    This function is the canonical implementation; it is re-exported from
    :mod:`app.agents.catalog._shared` for backward compatibility.
    """

    if not isinstance(text, str):
        return fallback
    text = text.strip()
    if not text:
        return fallback
    return text.splitlines()[0][:max_chars]


def merge_keyed_string_updates(
    parsed_items: Any,
    deterministic_items: Any,
    *,
    key_from_parsed: Callable[[Any], Any],
    key_from_deterministic: Callable[[dict[str, Any], int], Any],
    string_fields: dict[str, int],
) -> list[dict[str, Any]]:
    """Merge polished string fields onto a deterministic baseline list.

    Polished values are taken first-line, stripped and length-capped per
    ``string_fields``; blank polished values keep the deterministic copy.
    Used by ``polish_readiness`` (key = field id) and ``polish_triage``
    (key = ``"{type}:{idx}"``) -- both want "validate, normalise, merge by
    key" without inventing new rows.

    This function is the canonical implementation; it is re-exported from
    :mod:`app.agents.catalog._shared` for backward compatibility.
    """

    polished_by_key: dict[Any, Any] = {}
    if isinstance(parsed_items, list):
        for item in parsed_items:
            k = key_from_parsed(item)
            if k:
                polished_by_key[k] = item
    out: list[dict[str, Any]] = []
    if not isinstance(deterministic_items, list):
        return out
    for idx, item in enumerate(deterministic_items):
        if not isinstance(item, dict):
            out.append(item)
            continue
        merged = dict(item)
        update = polished_by_key.get(key_from_deterministic(item, idx))
        if update is not None:
            for field_name, max_chars in string_fields.items():
                polished = cap_polished_text(
                    getattr(update, field_name, ""),
                    max_chars=max_chars,
                    fallback="",
                )
                if polished:
                    merged[field_name] = polished
        out.append(merged)
    return out


class PolishStep(Generic[_SchemaT]):
    """Declarative single LLM polish pass.

    Parameters
    ----------
    prompt_fn:
        ``(state) -> str | list`` -- builds the prompt sent to the LLM.
        May return a string (wrapped in a
        :class:`~langchain_core.messages.HumanMessage`) or an
        already-prepared list of LangChain message objects.
    schema:
        Pydantic ``BaseModel`` subclass the LLM fills via
        ``with_structured_output(schema, include_raw=True)``.
    fallback_fn:
        ``(state) -> Any`` -- returns the deterministic value to use when
        the model is the stub, raises, or returns a parse error.
    merge_fn:
        ``(state, polished_or_fallback) -> dict`` -- merges the polished (or
        fallback) value back into state and returns the update dict.
        Required unless ``cap_field`` is provided.
    redact:
        Optional ``(Any) -> Any`` applied to the prompt *text* before it is
        sent to the LLM.  When ``prompt_fn`` returns a string the redaction
        is applied to that string; when it returns a list the caller is
        responsible for redacting inside ``prompt_fn``.
    cap_field:
        Optional ``(field_name, max_chars)`` shorthand for the common
        pattern of extracting a single string field from the parsed schema,
        capping it via :func:`cap_polished_text`, and returning
        ``{"_result": capped}``.  When set, ``merge_fn`` must be ``None``
        (it is auto-generated).  The fallback in the cap call is always
        ``state["_deterministic"]``.
    cap_text:
        Deprecated alias kept for the Phase 3 stub; ignored.  Use
        ``cap_field`` instead.

    Notes
    -----
    The ``redact`` parameter is *declarative*: nodes no longer need to
    import :func:`app.tools.redaction.redact_dict` themselves; they just
    set ``redact=redact_dict`` on the step.  The ``prompt_fn`` is called
    first (raw state), then ``redact`` is applied to the string result
    before the LLM sees it.  When ``prompt_fn`` returns a list ``redact``
    is ignored (the caller already applied redaction inside ``prompt_fn``).
    """

    def __init__(
        self,
        *,
        prompt_fn: Callable[[Any], Any],
        schema: type[_SchemaT],
        fallback_fn: Callable[[Any], Any],
        merge_fn: Optional[Callable[[Any, Any], dict[str, Any]]] = None,
        redact: Optional[Callable[[Any], Any]] = None,
        cap_field: Optional[tuple[str, int]] = None,
        cap_text: Optional[int] = None,  # noqa: ARG002 -- deprecated, ignored
    ) -> None:
        if cap_field is not None and merge_fn is not None:
            raise ValueError("Provide either cap_field or merge_fn, not both.")
        if cap_field is None and merge_fn is None:
            raise ValueError("Either cap_field or merge_fn must be provided.")

        self._prompt_fn = prompt_fn
        self._schema = schema
        self._fallback_fn = fallback_fn
        self._redact = redact

        if cap_field is not None:
            _field_name, _max_chars = cap_field

            def _cap_merge(state: Any, value: Any) -> dict[str, Any]:
                raw = (
                    getattr(value, _field_name, value)
                    if isinstance(value, schema)
                    else value
                )
                return {
                    "_result": cap_polished_text(
                        raw,
                        max_chars=_max_chars,
                        fallback=state["_deterministic"],
                    )
                }

            self._merge_fn: Callable[[Any, Any], dict[str, Any]] = _cap_merge
        else:
            assert merge_fn is not None  # guarded above
            self._merge_fn = merge_fn

    async def run(
        self,
        state: Any,
        model: Any,
    ) -> tuple[dict[str, Any], int, int]:
        """Execute the polish step and return ``(update_dict, tokens_in, tokens_out)``.

        The four-cell matrix:

        1. Stub model -> use fallback, return ``(merge(state, fallback), 0, 0)``.
        2. Real model, success -> merge parsed result.
        3. Real model, parse error -> log warning, use fallback, keep token counts.
        4. Real model, raises -> log warning, use fallback, return 0 tokens.

        The raw ``AIMessage`` (with ``usage_metadata``) is **not** included in
        the returned update dict -- that is the caller's responsibility (mirrors
        how the existing ``_polish_*`` helpers work; the node decides whether to
        append the raw message to ``state["messages"]``).
        """

        from app.agents.catalog._shared import unpack_structured_response
        from app.agents.llm import extract_token_usage, is_stub_model
        from langchain_core.messages import HumanMessage

        fallback = self._fallback_fn(state)

        if is_stub_model(model):
            return self._merge_fn(state, fallback), 0, 0

        # Build prompt
        raw_prompt = self._prompt_fn(state)

        # Apply redaction only when prompt_fn returned a plain string.
        if isinstance(raw_prompt, str):
            if self._redact is not None:
                raw_prompt = self._redact(raw_prompt)
            messages = [HumanMessage(content=raw_prompt)]
        else:
            # Caller returned a list of message objects (redaction already applied
            # inside prompt_fn).
            messages = raw_prompt

        try:
            response = await model.with_structured_output(
                self._schema, include_raw=True
            ).ainvoke(messages)
        except Exception:  # noqa: BLE001
            logger.warning(
                "PolishStep(%s) provider call raised; falling back to deterministic.",
                self._schema.__name__,
                exc_info=True,
            )
            return self._merge_fn(state, fallback), 0, 0

        raw_msg, parsed, parse_error = unpack_structured_response(response)
        tokens_in, tokens_out = extract_token_usage(raw_msg)

        if parse_error is not None or not isinstance(parsed, self._schema):
            logger.warning(
                "PolishStep(%s) parse error or wrong type (%s); falling back.",
                self._schema.__name__,
                type(parsed).__name__,
            )
            return self._merge_fn(state, fallback), tokens_in, tokens_out

        return self._merge_fn(state, parsed), tokens_in, tokens_out


__all__ = ["PolishStep", "cap_polished_text", "merge_keyed_string_updates"]
