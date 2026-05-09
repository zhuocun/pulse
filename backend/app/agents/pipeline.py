"""Linear-graph DSL for Board Copilot catalog agents.

Most catalog agents are simple ``START → A → B → ... → END`` chains.
:func:`linear_graph` builds that structure from a list of ``(name, fn)``
pairs so each agent file only needs one call instead of repeated
``add_node`` / ``add_edge`` boilerplate.
"""

from __future__ import annotations

from typing import Any, Callable

from langgraph.graph import END, START, StateGraph


def linear_graph(
    state_schema: type,
    nodes: list[tuple[str, Callable[..., Any]]],
    context_schema: type | None = None,
) -> StateGraph:
    """Build a linear :class:`~langgraph.graph.StateGraph`.

    ``START → nodes[0] → nodes[1] → ... → nodes[-1] → END``

    Args:
        state_schema: The TypedDict class that describes graph state.
        nodes: An ordered list of ``(name, fn)`` pairs.  Each ``fn``
            receives the current state dict and returns a partial-update
            dict (standard LangGraph node contract).
        context_schema: Optional context schema forwarded to
            :class:`~langgraph.graph.StateGraph` as ``context_schema``.

    Returns:
        An un-compiled :class:`~langgraph.graph.StateGraph` ready for
        ``.compile(checkpointer=..., store=...)``.
    """
    graph: StateGraph = StateGraph(state_schema, context_schema=context_schema)
    for name, fn in nodes:
        graph.add_node(name, fn)
    prev: str = START
    for name, _ in nodes:
        graph.add_edge(prev, name)
        prev = name
    graph.add_edge(prev, END)
    return graph
