# Theme 4 — FE resume depth deferred (2026-05-11)

Thread identifier continuity across **refresh** ships via `sessionStorage` keyed by
`(agent, projectId)` in `useAgent` (`src/utils/hooks/useAgent.ts`). Operator guidance
for SSE idempotency, retries, and completed-stream handling ships in
[`../operations/agent-stream-resume.md`](../operations/agent-stream-resume.md).

The following items remain **out of scope for the architecture closeout train** —
they need explicit product/security decisions before implementation:

- **Optional multi-tab / broadcast thread policy** — choosing a single writer vs
  cross-tab `BroadcastChannel` coordination touches UX contracts and duplicate-action
  risk; no stable internal spec exists in-repo beyond single-tab persistence today.
- **Persisting minimal resume handles beyond thread id** — e.g. last LangGraph
  interrupt id in durable FE storage — implies encryption/privacy review and
  cross-device semantics the PRD does not yet pin down.

Re-open these as scoped epics when GA mutation lifecycle and autonomy enforcement
are stable enough to prioritize multi-surface agent sessions.
