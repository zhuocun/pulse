# Production Readiness — Board Copilot Frontend

Consolidated view of what is GA-ready, what is internal-beta-only, and what blocks a public ship from the React client side. Source of truth for severity; for the per-feature detail and file/test inventory see [`prd/board-copilot-progress.md`](prd/board-copilot-progress.md). Server-side counterpart: `jira-python-server/docs/PRODUCTION_READINESS.md`.

Last updated: 2026-05-05.

## TL;DR

- **GA-ready surfaces.** All six v2.1 SSE agents consumed via `useAgent` / `useAgentChat` in remote builds; deterministic local-engine fallback under `aiUseLocalEngine`; PRD AC-V14 nudge inbox; autonomy selector; observability; jest-axe a11y coverage; typed `{code, message}` error envelope.
- **Internal beta only.** Anything that surfaces `MutationProposalCard` to the user — see Hard Blocker §1.
- **Blocks public GA.** Two FE-owned hard blockers below; the rest is polish or out of FE scope.

## ⚠️ GA blocker urgency — resolve ASAP

**The product is NOT ready for public GA.** Each 🛑 hard blocker below is a release gate, not a backlog item. Until all hard blockers are closed, the only acceptable deployment posture is **internal beta with proposal cards gated off** (see Hard Blocker §1 mitigation).

- **Every additional day a hard blocker remains open is risk.** Blocker §1 ships a customer-visible dead-end UX; blocker §2 is a security exposure that worsens with each new FE entry-point that touches `localStorage`.
- **Owners must be assigned per blocker, not per polish item.** The polish queue can wait; the hard blockers cannot.
- **No public marketing, no design-partner expansion, no removal of the proposal-card gate** until both 🛑 entries below show ✅ in this doc.
- **Re-audit weekly** until ✅. If a blocker is reclassified, justify it in this file.

The Recommended ship sequence at the bottom of this doc is the contract: internal beta → design-partner GA → public GA, gated on the explicit blocker closures listed there.

## Severity tags

- **🛑 GA-blocker.** Customer-visible failure or material security risk. Must close before public ship.
- **⚠️ Soft blocker.** Quality or reliability ceiling that limits scope; ship-able with documented caveats.
- **🟡 Polish.** Internal hygiene; no customer impact.

## Hard blockers — must close before public GA

### 🛑 1. `MutationProposalCard` accept path goes nowhere in remote mode

`AiChatDrawer` renders `MutationProposalCard` and wires `onAccept` to `agentChat.resumeProposal(true)` which calls `agent.resume({accepted: true})` on the SSE stream. The BE then has nothing to do — no agent emits `custom/mutation_proposal` and no `fe.applyMutation` interrupt is registered. The user sees the card vanish but no mutation is applied.

- File: `src/components/aiChatDrawer/index.tsx` accept handler; `src/components/mutationProposalCard/index.tsx`.
- BE counterpart: `jira-python-server/docs/AI_REMAINING_WORK.md` §12.
- **FE-side work needed once BE ships:** register `fe.applyMutation` in `FE_TOOL_REGISTRY`; add `onUndo` prop on `MutationProposalCard`; wire `AGENT_PROPOSAL_UNDONE` (currently defined but never fires) to the undo callback; confirm AC-V4 10-second undo toast.
- **Mitigation for internal beta:** do not pass `pendingProposal` into `AiChatDrawer`. The drawer hides the card render path automatically.

### 🛑 2. JWT-in-localStorage XSS exfiltration surface

`src/utils/aiAuthHeader.ts` reads the primary bearer JWT from `localStorage` and the AI proxy reuses it verbatim. Any FE XSS exfiltrates the AI proxy token alongside the REST API token. Documented in [`prd/board-copilot-progress.md`](prd/board-copilot-progress.md) "Product / UX gaps" but explicitly "Not addressed."

- Mitigation path: migrate token storage to httpOnly cookie, or issue a short-lived proxy-scoped token with a narrow claim set. Either approach requires a BE change.
- Effort: ~1 week of cross-repo work (BE token issuance + FE storage migration + middleware updates).

## Soft blockers — ship-able with documented caveats

### ⚠️ 3. Search / estimation quality bounded by BE limits

`useAgent("search-agent")` and `useAgent("task-estimation-agent")` work end-to-end, but the BE's embedding dimensions are pinned to 16 and there is no vector store. The FE `fe.searchCandidates` tool tops out at 50 candidates per kind. Quality ceiling is set on the BE.

- Detail: `jira-python-server/docs/AI_REMAINING_WORK.md` §8.
- **No FE-side fix.** Disclose in product copy that semantic search is suggestion-grade.

### ✅ 4. AC-V5 preapproved-tools auto-autonomy not implemented (Resolved 2026-05-05)

Resolved on `claude/v2.1-ai-readiness-check-TbxeM` by hard-disabling the "Auto" option in `AiChatDrawer` with an explanatory i18n tooltip ("Auto requires an agent that supports preapproved tools. Available in v3."). The metadata-driven gating against `AgentMetadata.allowed_autonomy` remains V3 work — see `docs/prd/board-copilot-v3.md`.

- Original symptom: the autonomy selector exposed "Auto" but it silently behaved like "Plan."
- Mitigation now in place: selector renders Suggest ✅, Plan ✅, Auto disabled with tooltip.

### ✅ 5. `AGENT_PROPOSAL_UNDONE` analytics defined but unfired (FE-side resolved 2026-05-05)

FE-side surface resolved on `claude/v2.1-ai-readiness-check-TbxeM`: `MutationProposalCard` now accepts an optional `onUndo` prop and fires `AGENT_PROPOSAL_UNDONE` from the click handler. The end-to-end Undo flow remains gated on Hard Blocker §1 — there is no BE undo endpoint yet, so callers can wire optimistic local undo today and the BE reversal will hook in when the lifecycle ships.

- Original symptom: `src/constants/analytics.ts` defined the constant; no call site.
- FE-side fix: optional CTA + analytics fire on click (see `mutationProposalCard/index.test.tsx`).

## Polish — no customer impact

### 🟡 6. v2.1 metadata fields not surfaced in UI

`AgentMetadata.allowed_autonomy`, `rate_limit`, `recursion_limit`, `context_schema`, `tags` are all on the BE wire but the FE consumer reads none of them. Zero impact on user-visible behaviour today; would let the autonomy selector self-gate and a future "limits" surface render rate / budget visibly.

### ✅ 7. `MutationProposalCard` undo CTA missing (Resolved 2026-05-05)

Resolved on `claude/v2.1-ai-readiness-check-TbxeM`: `MutationProposalCard` now accepts `onUndo?: () => void` and renders a conditional Undo button when `proposal.undoable === true`. See item #5 above for the analytics-fire side and the BE coupling note.

### ✅ 8. `useAi.ts:206` `TODO(v2.x)` comment (Resolved 2026-05-05)

Removed on `claude/v2.1-ai-readiness-check-TbxeM`. The surrounding docblock already documents `useAi`'s post-v2.1 role as the deterministic local-engine fallback only.

## What's GA-ready right now

| Surface                                                                        | Status | Notes                                                                 |
| ------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------- |
| Local engine (deterministic)                                                   | ✅     | Full coverage; demo-able with no backend                              |
| `useAgent("board-brief-agent")` (remote)                                       | ✅     | Suggestion + citations rendered in `BoardBriefDrawer`                 |
| `useAgent("task-drafting-agent")` (remote)                                     | ✅     | Two sequential interrupts auto-resumed                                |
| `useAgent("task-estimation-agent")` (remote)                                   | ⚠️     | Quality bounded by §3                                                 |
| `useAgent("search-agent")` (remote)                                            | ⚠️     | Quality bounded by §3                                                 |
| `useAgentChat("chat-agent")` (remote)                                          | ✅     | SSE streaming; **proposal cards must be hidden** until BE §1 closes   |
| `useAgent("triage-agent")` (remote)                                            | ✅     | AC-V14 inbox rules (cap-5, dedup, 4-hour expiry, dismiss-propagation) |
| Autonomy selector UI                                                           | ⚠️     | Suggest/Plan ✅; Auto silently no-ops — see §4                        |
| Agent health badge in header                                                   | ✅     | Renders only when `degraded`/`offline` and remote mode                |
| `useAgentHealth` + `AGENT_HEALTH_DEGRADED` analytics                           | ✅     | Deduped per transition                                                |
| Per-project AI opt-out + typed 403 envelope                                    | ✅     | `mapErrorResponse` honors `body.code` (Resolved 2026-05-05)           |
| `AGENT_TURN_STARTED` / `AGENT_TURN_COMPLETED` observability                    | ✅     | TTFT, durationMs, tokensIn/Out                                        |
| `Idempotency-Key` header on all AI requests                                    | ✅     |                                                                       |
| i18n (`en`, `zh-CN`) for AI surfaces                                           | ✅     | Including autonomy selector keys                                      |
| jest-axe a11y coverage                                                         | ✅     | 31 tests across all AI surfaces                                       |
| `REACT_APP_AI_BASE_URL` validation (rejects `javascript:` / `data:` / `file:`) | ✅     |                                                                       |
| `Disable AI for this project` switch                                           | ✅     | `boardCopilot:disabledProjectIds`                                     |
| `Board Copilot` runtime toggle                                                 | ✅     | `boardCopilot:enabled`                                                |

## Recommended ship sequence

1. **Internal beta (today).** Deploy with `pendingProposal` always undefined on `AiChatDrawer` (or remove `MutationProposalCard` from the import). Use the v2.1 surface for read-only / suggestion flows. Document the "Auto" autonomy no-op and the search/estimation quality ceiling.
2. **Design-partner GA (~3 weeks).** Close hard blocker §2 (proxy-scoped token migration). Either remove the "Auto" option from the autonomy selector or wire `allowed_autonomy` and the AC-V5 preapproved tools.
3. **Public GA (~6–8 weeks).** Close hard blocker §1 once the BE `MutationProposal` lifecycle ships: register `fe.applyMutation`, add the `onUndo` CTA, wire `AGENT_PROPOSAL_UNDONE`. Surface proposal cards.

## Audit follow-up — 2026-05-05 (`claude/v2.1-ai-readiness-check-TbxeM`)

A focused polish pass against the audit findings above. Cross-repo sibling
branch (BE polish) is `claude/v2.1-ai-readiness-check-TbxeM` on
`jira-python-server`. This branch closes only the small-effort polish items;
the three GA-blockers below are explicitly out of scope and remain open.

**Resolved on this branch (FE):**

- ✅ **#4 — Autonomy "Auto" no-op.** The "Auto" option in
  `AiChatDrawer` is now hard-disabled with an i18n tooltip explaining
  "Auto requires an agent that supports preapproved tools. Available
  in v3." A `TODO(v3)` in `src/components/aiChatDrawer/index.tsx`
  references the V3 PRD for the metadata-driven gating that follows
  the BE preapproved-tool registry. Selector behaviour: Suggest ✅,
  Plan ✅, Auto disabled with tooltip. Jest test
  `aiChatDrawer/index.test.tsx → "renders the Auto autonomy option as
disabled with an explanatory tooltip"` covers the conditional render.
- ✅ **#5 — `AGENT_PROPOSAL_UNDONE` unfired.** The FE-side surface now
  exists: `MutationProposalCard` accepts an optional `onUndo` prop,
  renders an Undo button when `proposal.undoable === true` AND
  `onUndo` is provided, and fires `AGENT_PROPOSAL_UNDONE` on click.
  The prop is intentionally optional so existing call sites (which
  don't supply `onUndo` because the BE doesn't emit a proposal yet)
  keep their previous render unchanged. Behaviour and a11y covered
  in `mutationProposalCard/index.test.tsx` (jest-axe + click +
  conditional-render assertions).
- ✅ **#8 — Stale `useAi.ts` `TODO(v2.x)`.** Removed. The surrounding
  docblock already documents `useAi`'s post-v2.1 role as the
  deterministic local-engine fallback only.

**Still open after this branch (cross-team / multi-week):**

- 🛑 **#1 — `MutationProposal` lifecycle.** No BE agent emits
  `custom/mutation_proposal`; no `fe.applyMutation` interrupt is
  registered (and intentionally not registered on this branch — without
  BE emission it would be dead code). Needs product/UX agreement on
  which mutations are allowed + the undo semantics, then a coordinated
  end-to-end branch. The BE-side counterpart is tracked on
  `jira-python-server` `claude/v2.1-ai-readiness-check-TbxeM` /
  `docs/AI_REMAINING_WORK.md` §12.
- 🛑 **#2 — JWT-in-localStorage XSS.** Requires BE token redesign
  (proxy-scoped short-lived token or httpOnly cookie). FE-side
  migration follows. Out of scope for this branch.
- ⚠️ **Provider 5xx fallback.** Server-side concern; BE polish branch
  owns the resilience pattern.

## Verification

```bash
npm install
npm run eslint                                              # must be clean (--max-warnings 0)
npx tsc --noEmit                                            # must be clean
CI=true npm test -- --watchAll=false --runInBand            # 142 suites / 1000 tests
npx vite build                                              # must succeed
```
