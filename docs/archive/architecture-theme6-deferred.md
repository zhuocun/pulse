# Theme 6 depth rows — explicit deferrals (2026-05-11)

The architecture backlog lists optional intelligence and resilience work
(F-9 hedging, full production embeddings ranking, ReAct migration F-12,
supervisor graphs F-13/F-14, MCP expansion F-15). The following remain
**non-actionable as GA-shaped deliverables** in this repository snapshot:

- **Hedged routing (F-9) beyond §2 failover:** the LangChain
  `with_fallbacks` path and `tests/test_llm_failover.py` already cover
  vendor failover. LiteLLM-/Portkey-style request hedging (parallel races,
  latency SLO routers) is product-specific and vendor-dependent; no stable
  internal API exists to ship without choosing an external gateway.
- **“Real” vector ranking depth:** pgvector DDL and wiring are in tree with
  operator env docs; ranking quality still depends on embeddings backfill,
  dimension alignment, and data governance — not a code-only closure.
- **`create_react_agent` / supervisor / memory namespaces:** these are
  large graph refactors gated on stable `MutationProposal` and autonomy
  enforcement (Theme 5 / release §1), not incremental toggles.

These items stay available as future epics once Theme 5 and contract baselines
stop churning the LangGraph catalog.
