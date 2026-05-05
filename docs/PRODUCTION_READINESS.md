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

### ⚠️ 4. AC-V5 preapproved-tools auto-autonomy not implemented

The autonomy selector exposes Suggest / Plan / Auto, but the "Auto" level does nothing different in remote mode — the FE doesn't read `AgentMetadata.allowed_autonomy` from `getAgentMetadata` and there are no preapproved tools wired (`assignTask`, in-column `moveTask`, `renameColumn` per PRD AC-V5).

- Detail: `prd/board-copilot-progress.md` open items.
- **Mitigation for now:** the selector still works; "Auto" silently behaves like "Plan." If shipping, either remove the "Auto" option from the selector or document the no-op.

### ⚠️ 5. `AGENT_PROPOSAL_UNDONE` analytics defined but unfired

`src/utils/observability/analytics.ts` defines the event constant; no call site. Blocked on BE side §1.

- Effort: 1 line + a test once the undo CTA exists on the proposal card.

## Polish — no customer impact

### 🟡 6. v2.1 metadata fields not surfaced in UI

`AgentMetadata.allowed_autonomy`, `rate_limit`, `recursion_limit`, `context_schema`, `tags` are all on the BE wire but the FE consumer reads none of them. Zero impact on user-visible behaviour today; would let the autonomy selector self-gate and a future "limits" surface render rate / budget visibly.

### 🟡 7. `MutationProposalCard` undo CTA missing

`undoable: true` renders a `Tag` badge but there is no Undo button, just a label. Add `onUndo?: () => void` prop and conditional button. Trivially small; meaningful only after BE §1 closes.

### 🟡 8. `useAi.ts:206` `TODO(v2.x)` comment

The TODO is stale — all six structured routes already migrated to `useAgent`. The comment can be removed; `useAi` is now exclusively the local-engine fallback path.

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

## Verification

```bash
npm install
npm run eslint                                              # must be clean (--max-warnings 0)
npx tsc --noEmit                                            # must be clean
CI=true npm test -- --watchAll=false --runInBand            # 142 suites / 1000 tests
npx vite build                                              # must succeed
```
