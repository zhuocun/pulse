"""Contract tests for FE tool schema integrity (PRD v2.1 §5.4.1).

(a) Every tool name declared in an agent's ``metadata.tools`` either:
    - starts with ``"fe."`` and exists in ``FE_TOOL_SCHEMAS``, OR
    - starts with ``"be."`` (BE-side tool, no schema registry to check).

    Bare LangGraph tool node names are model-internal and must not appear
    in public agent metadata.

(b) For every entry in ``FE_TOOL_SCHEMAS``, ``interrupt_payload(name, args)``
    round-trips correctly: a minimal args dict built from ``required``
    fields (using placeholder strings for ``string``-typed fields) returns
    ``{"tool": name, "args": args}`` without raising.
"""

from __future__ import annotations

import app.agents.catalog as catalog
from app.agents.registry import registry
from app.tools.fe_tool_schemas import FE_TOOL_SCHEMAS, interrupt_payload


# ---------------------------------------------------------------------------
# (a) Catalog tool references are valid
# ---------------------------------------------------------------------------


def test_catalog_tool_references_are_valid() -> None:
    """Every tool declared in agent metadata must resolve to a known schema."""

    # Ensure all catalog agents are registered via the explicit manifest.
    catalog.register_all(registry)

    errors: list[str] = []
    for meta in registry.metadata():
        for tool_name in meta.tools:
            if tool_name.startswith("fe."):
                if tool_name not in FE_TOOL_SCHEMAS:
                    errors.append(
                        f"Agent {meta.name!r}: FE tool {tool_name!r} not found in "
                        f"FE_TOOL_SCHEMAS"
                    )
            elif tool_name.startswith("be."):
                # BE-side tools have no schema registry; allow all.
                pass
            else:
                errors.append(
                    f"Agent {meta.name!r}: public tool metadata must use a "
                    f"qualified tool name, got {tool_name!r}"
                )

    assert not errors, "\n".join(errors)


# ---------------------------------------------------------------------------
# (b) Required args round-trip through interrupt_payload
# ---------------------------------------------------------------------------


def _build_minimal_args(name: str, schema: dict) -> dict:  # type: ignore[type-arg]
    """Build a minimal valid args dict for ``interrupt_payload`` from the schema.

    Only fields listed under ``required`` are included. Each required field
    gets a placeholder value whose type matches the schema's ``type``
    declaration for that property: strings get ``"placeholder"``, integers
    get ``1``, booleans get ``True``, objects get ``{}``, arrays get ``[]``.
    Fields whose type cannot be determined fall back to ``"placeholder"``.
    """

    args_schema = schema.get("args_schema", {})
    required = args_schema.get("required", [])
    properties = args_schema.get("properties", {})
    args: dict[str, object] = {}
    for field in required:
        prop = properties.get(field, {})
        prop_type = prop.get("type", "string")
        if prop_type == "string":
            args[field] = "placeholder"
        elif prop_type == "integer":
            args[field] = 1
        elif prop_type == "boolean":
            args[field] = True
        elif prop_type == "object":
            args[field] = {}
        elif prop_type == "array":
            args[field] = []
        else:
            args[field] = "placeholder"
    return args


def test_interrupt_payload_round_trip_for_all_fe_tools() -> None:
    """interrupt_payload must return {tool, args} for every FE tool schema."""

    for name, schema in FE_TOOL_SCHEMAS.items():
        args = _build_minimal_args(name, schema)
        result = interrupt_payload(name, args)
        assert result == {"tool": name, "args": args}, (
            f"interrupt_payload({name!r}, {args!r}) returned unexpected shape: "
            f"{result!r}"
        )
