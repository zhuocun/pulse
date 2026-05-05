"""Tool implementations for Board Copilot v2.1.

The ``tools`` package contains the deterministic Python helpers that the
agents in :mod:`app.agents.catalog` use:

- :mod:`app.tools.redaction` -- server-side PII redaction (PRD §5A.10 / §6.7).
- :mod:`app.tools.fe_tool_schemas` -- JSON schemas for FE-side read tools
  (PRD §5.4.1) plus :func:`interrupt_payload` helpers.
- :mod:`app.tools.be_tools` -- BE-side helpers (summarise / embed / drift /
  budget) used inside agent graphs (PRD §5.5).
"""
