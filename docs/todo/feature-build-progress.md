# Feature build progress — completeness build-out

Implementation of the feature set from the completeness review/brainstorm,
built in dependency-ordered milestones. Each milestone is reviewed +
gated + committed before the next. Branch: `claude/clever-gauss-YckJC`.

## Gate commands (must pass per milestone)
- Backend lint: `cd backend && .venv/bin/ruff check .`
- Backend tests: `cd backend && env -u DEEPSEEK_API_KEY COVERAGE_FILE=/tmp/cov .venv/bin/python -m pytest`
  (CI = `pip install -e ".[dev,ai]"` then `ruff check .` then `pytest`; 85% coverage gate.)
  NOTE: the container sets `DEEPSEEK_API_KEY`; the suite assumes "no key
  => stub provider", so unset it locally to match CI.
- Frontend: `npm run typecheck && npm run eslint && npm test`

### Known PRE-EXISTING failures (not regressions; ignore until AI milestone)
- `tests/test_agents_catalog.py::test_chat_agent_propagates_cancellation_through_provider_call`
- `tests/test_ai_v1_router.py::test_chat_returns_text_via_chat_agent`
  (AI chat-agent response shape; confirmed pre-existing via stash.)

## Milestones
- [x] **M1 — Project membership + RBAC (backend)**. `memberIds:[{userId,role}]`
  (owner>editor>viewer); `can_access(project,user,min_role)`;
  `is_project_manager`=owner shim. Member CRUD `/api/v1/projects/members`
  (owner-only; manager=immutable root of trust). Read=viewer, write=editor
  on task/board. Owner auto-membered; listing=owned+member-of (Python
  filter, FakeStore-safe). Tests: `backend/tests/test_rbac.py`. Gate green
  (ruff, 96% cov). Reviewed APPROVE (no escalation/IDOR/leak).
- [x] **M2 — Task & board richness (backend)**: due/start dates, labels,
  multi-assignee, sub-tasks (`parentTaskId`), per-column WIP limits, bulk
  task endpoint `PUT /api/v1/tasks/bulk`.
- [x] **M3 — Comments + @mentions; Notifications model + bell (backend)**.
- [ ] **M4 — Frontend surfaces for M1–M3** (members tab, task fields,
  lensChips dueDate activation, notifications bell, comments UI).
- [ ] **M5 — Unified Copilot rail rebuild; action-capable command palette;
  shared saved views; cross-project search**.
- [ ] **M6 — Reporting (velocity/WIP/throughput); admin AI-gating
  dashboard; keyboard-first surface**.
- [ ] **M7 — Attachments (GridFS); real-time board sync (SSE);
  export/webhooks**.
- [ ] **M8 — Bets: autopilot lanes; org-wide audit history; "plan this
  sprint"**.

### Open decisions (carry forward)
- AI/agent routes (`ai.py`, `agents.py`) remain owner-gated. Decide in the
  AI milestone whether editors should get AI access (`can_access(...,
  ROLE_EDITOR)`).
- `memberIds` returned in `GET /projects`. Consider a derived `myRole`
  field during FE integration instead of the raw list.

### Excluded (per review "don't build")
MCP, voice, CRDT co-editing, four-level autonomy dial, configurable
end-user prompts, cross-project planning.
