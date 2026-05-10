# Board Copilot AI UX Audit and Optimization Plan

> **Archived 2026-05-10.** All five phases below shipped; the forward-looking
> spec is now [`../prd/v3-ai-ux.md`](../prd/v3-ai-ux.md). This audit is
> kept for historical traceability and resolved-items log.

Updated: 2026-05-04

This document audits the current `pulse` Board Copilot implementation
against current AI UI/UX best practices and red flags from Google PAIR,
Microsoft HAX, NN/g, NIST AI RMF, OpenAI app UX guidance, W3C accessibility
guidance, IBM explainability guidance, Apple privacy guidance, and Anthropic
agent-safety patterns.

The previous version of this file was stale: several listed issues have since
been fixed in the codebase. This version reflects the current implementation.

---

## 1. Scope and methodology

### Surfaces audited

- Global enablement and route entry points:
    - `src/components/header/index.tsx`
    - `src/pages/board.tsx`
    - `src/components/commandPalette/index.tsx`
- AI feature components:
    - `src/components/aiChatDrawer/index.tsx`
    - `src/components/aiSearchInput/index.tsx`
    - `src/components/boardBriefDrawer/index.tsx`
    - `src/components/aiTaskDraftModal/index.tsx`
    - `src/components/aiTaskAssistPanel/index.tsx`
    - `src/components/aiSuggestedBadge/index.tsx`
    - `src/components/copilotPrivacyPopover/index.tsx`
- AI hooks and data contracts:
    - `src/utils/hooks/useAi.ts`
    - `src/utils/hooks/useAiChat.ts`
    - `src/utils/hooks/useAgent.ts`
    - `src/utils/ai/engine.ts`
    - `src/utils/ai/chatEngine.ts`
    - `src/utils/ai/chatTools.ts`
    - `src/utils/ai/validate.ts`
    - `src/utils/ai/projectAiStorage.ts`
- Planning and reference docs:
    - `docs/prd/v3-ai-ux.md`
    - `docs/status/changelog.md`
    - `docs/status/ui-plan.md`
    - `AI_UX_BEST_PRACTICES.md` _(removed — generic research compilation; actionable content absorbed into this document)_
    - `AI_UX_PATTERNS_REPORT.md` _(removed — generic AI interaction patterns; actionable content absorbed into this document)_

### Verification note

I attempted a targeted Jest run for the main AI components, but the current
cloud image does not have `npm` available:

```text
npm test ... -> npm: command not found
```

The findings below are therefore based on static source inspection and existing
project documentation, not a live browser sweep or executable test run.

---

## 2. Executive summary

Board Copilot is no longer a naive AI add-on. The current implementation already
contains many best-practice patterns:

- AI output is visibly attributed to Board Copilot.
- The app has global and per-project disable controls.
- AI prompts, drafts, estimates, brief generation, and search are guarded by
  project opt-out checks.
- Structured outputs are validated before rendering or applying.
- Confidence bands are used for task draft and estimate surfaces.
- AI-filled fields can show "Suggested by Copilot" provenance.
- Chat has sample prompts, stop, regenerate, feedback buttons, retry, character
  limit, and collapsed tool details.
- Privacy disclosure is available across major AI surfaces.
- AI drawers use responsive widths and safe-area padding.
- Several AI surfaces now use live regions, skeletons, and delayed spinners.

The remaining issues are subtler and mostly concern **trust calibration,
governance, consistency, and agent-readiness**:

1. Chat and board brief answers can still look more authoritative than their
   deterministic local engine and weak citation model justify.
2. Remote AI mode sends the same bearer auth token to `REACT_APP_AI_BASE_URL`,
   but the UI does not distinguish local vs remote processing or third-party
   data flow.
3. "What is shared" copy conflicts with actual payloads in some surfaces,
   especially task notes.
4. AI feedback is too shallow to improve quality or explain what user feedback
   changes.
5. Some AI writes have incomplete undo/revert semantics.
6. Agentic infrastructure exists but is not integrated into product surfaces,
   which creates future risk if shipped partially.
7. Analytics constants exist; observability sinks (`httpAnalyticsSink`, `httpErrorSink`,
   `devMemorySink`) were added 2026-05-04 (`src/utils/observability/sinks.ts`) and wired
   from `src/index.tsx` via `VITE_ANALYTICS_ENDPOINT` / `VITE_ERROR_REPORT_ENDPOINT`.
   Individual `track()` call sites are wired (2026-05-04, follow-up commit): the
   v2.1 events `AGENT_TURN_STARTED` / `AGENT_TURN_COMPLETED`, `AGENT_HEALTH_DEGRADED`,
   and `COPILOT_REWRITE_ACCEPT` now fire from `useAgent.ts`, `useAgentHealth.ts`, and
   `aiTaskAssistPanel/index.tsx` respectively. `AGENT_PROPOSAL_UNDONE` now fires from the 10-second undo path on
   `MutationProposalCard` (resolved 2026-05-05). All analytics events fire.
8. ~~AI entry points remain fragmented across header, board header, filters,
   modals, drawers, and command palette.~~ **Resolved (2026-05-05):** `CopilotMenu`
   dropdown added to board header; `copilotShell/` provides a unified Chat/Brief/Activity/Settings
   right-rail shell; command palette AI mode routes to the shell Chat tab.

---

## 3. What the project already does well

These strengths should be preserved while optimizing.

### 3.1 AI attribution and expectations

- Assistant turns are labeled with the Board Copilot attribution in
  `src/components/aiChatDrawer/index.tsx:579-635`.
- Assistant output includes the explicit `AI · review before using` disclaimer
  in `src/components/aiChatDrawer/index.tsx:632-635`.
- Draft and estimate surfaces show AI badges in
  `src/components/aiTaskDraftModal/index.tsx:491-508` and
  `src/components/aiTaskAssistPanel/index.tsx:290-298`.

Why it matters: this follows Google PAIR, Microsoft HAX, IBM, and NN/g guidance
that AI involvement should be visible and users should not mistake generated
content for human-authored content.

### 3.2 User control and reversibility

- Chat has stop and regenerate controls in
  `src/components/aiChatDrawer/index.tsx:646-686` and
  `src/components/aiChatDrawer/index.tsx:818-836`.
- Drafted tasks are shown in a form for user review before creation in
  `src/components/aiTaskDraftModal/index.tsx:481-622`.
- Task estimate application uses a toast undo path in
  `src/components/aiTaskAssistPanel/index.tsx:173-191`.
- Bulk task creation attempts a best-effort undo in
  `src/components/aiTaskDraftModal/index.tsx:264-289`.
- Project-level AI opt-out is enforced in
  `src/utils/hooks/useAi.ts:253-283`,
  `src/utils/hooks/useAiChat.ts:111-119`, and
  `src/utils/ai/projectAiStorage.ts:26-40`.

Why it matters: these patterns reduce the risk of overautomation and align with
NIST, Anthropic, OpenAI, and Google PAIR recommendations on human control.

### 3.3 Validation and constrained outputs

- Structured AI responses are validated before use in
  `src/utils/ai/validate.ts:15-125`.
- Drafts clamp story points and replace invalid column/member ids in
  `src/utils/ai/validate.ts:15-49`.
- Search ids are intersected with known cache ids in
  `src/utils/ai/validate.ts:119-125`.
- Chat tool calls are allowlisted and read-only in
  `src/utils/ai/chatTools.ts:3-122`.

Why it matters: this is a strong product-level safety layer, not just a model
safety assumption.

### 3.4 Discoverability and onboarding

- Empty chat includes sample prompts in
  `src/components/aiChatDrawer/index.tsx:514-534`.
- Follow-up prompt chips appear after chat turns in
  `src/components/aiChatDrawer/index.tsx:692-715`.
- Draft modal offers sample prompts in
  `src/components/aiTaskDraftModal/index.tsx:377-389`.
- Command palette supports AI mode through `/` or a sparkle toggle in
  `src/components/commandPalette/index.tsx:423-433` and
  `src/components/commandPalette/index.tsx:521-542`.

Why it matters: these reduce the blank-page problem common in AI chat UIs.

### 3.5 Latency and failure states

- Chat displays staged loading/skeleton UI in
  `src/components/aiChatDrawer/index.tsx:717-769`.
- Search has retryable no-match and error states in
  `src/components/aiSearchInput/index.tsx:338-401`.
- Brief drawer caches results and exposes regenerate/copy controls in
  `src/components/boardBriefDrawer/index.tsx:235-280` and
  `src/components/boardBriefDrawer/index.tsx:366-418`.
- Task assist uses delayed spinners in
  `src/components/aiTaskAssistPanel/index.tsx:83-90`.

Why it matters: AI features must treat waiting, failure, retry, and empty states
as normal paths.

---

## 4. Current issues and red flags

### P0-1: Privacy disclosure is not fully accurate for every AI surface

**Best-practice violation:** transparent data use, privacy control, no privacy
surprises.

**Evidence**

- Global AI microcopy says Board Copilot sees "task names, columns, and member
  names" and "No notes, emails, or attachments" in
  `src/constants/microcopy.ts:178-180`.
- `CopilotPrivacyPopover` similarly says no task notes are ever sent in
  `src/components/copilotPrivacyPopover/index.tsx:73-83`.
- But several AI payloads do include `note` values:
    - Task estimate includes `note` in
      `src/utils/ai/engine.ts:253-256`.
    - Semantic task search includes `task.note` in
      `src/utils/ai/engine.ts:501-505`.
    - Draft/estimate/readiness payloads pass full task context from
      `src/components/aiTaskDraftModal/index.tsx:147-155` and
      `src/components/aiTaskAssistPanel/index.tsx:123-153`.
    - Chat tool `getTask` can return `t.note` in
      `src/utils/ai/chatEngine.ts:259-270`.

**Impact**

Users are told notes are not shared, while actual local/remote AI payloads can
include notes. In local mode this is less risky, but in remote mode it becomes a
material privacy and trust issue.

**Optimization plan**

1. Define a single `AiDataScope` contract per route:
    - `chat`
    - `search`
    - `board-brief`
    - `task-draft`
    - `task-breakdown`
    - `estimate`
    - `readiness`
2. Update privacy copy to be route-aware:
    - Chat/search/estimate/readiness: disclose whether task notes are included.
    - Draft from prompt: disclose prompt text and selected board context.
    - Brief: disclose aggregate task, column, and member data.
3. If notes should not be shared remotely, sanitize contexts before
   `remoteResolve` and `remoteChatStep`.
4. Add tests asserting the privacy disclosure matches the route payload.
5. Add a "Manage data sources" affordance later if users can choose whether
   notes are included.

**Acceptance criteria**

- No UI text says notes are excluded on a surface that sends notes.
- Every AI surface has route-specific "What is shared?" copy.
- Remote payload tests prove excluded fields are actually omitted.

---

### P0-2: Remote AI mode lacks explicit third-party / server-processing disclosure

**Best-practice violation:** hidden data transfer, unclear consent, weak privacy
surface.

**Evidence**

- `REACT_APP_AI_BASE_URL` switches the app from local deterministic engine to
  remote `POST ${aiBaseUrl}/api/ai/{route}` in
  `src/constants/env.ts:12-20` and `src/utils/hooks/useAi.ts:202-220`.
- Remote calls include the same bearer auth header in
  `src/utils/hooks/useAi.ts:207-213` and
  `src/utils/hooks/useAiChat.ts:38-59`.
- User-facing privacy copy describes categories of data but not local vs remote
  processing, retention, training, or recipient service.

**Impact**

Users and deployers cannot tell whether Board Copilot is local-only or sending
data and auth credentials to an external AI proxy. This is a governance risk and
a possible enterprise blocker.

**Optimization plan**

1. Add an environment-derived processing mode label:
    - "Runs locally in this app" when `aiUseLocalEngine` is true.
    - "Processed by your configured AI service" when remote mode is active.
2. Add remote-specific privacy text:
    - service/base origin,
    - data categories sent,
    - auth/permission behavior,
    - retention/training policy link or "configured by workspace admin".
3. In remote mode, show first-use consent per user/workspace before first AI
   request.
4. Consider proxy-scoped tokens instead of forwarding the primary REST bearer
   token directly.
5. Document required DPA/security expectations next to
   `REACT_APP_AI_BASE_URL` setup docs.

**Acceptance criteria**

- Users can tell local vs remote mode before sending an AI prompt.
- Remote mode has a consent/disclosure checkpoint.
- Security docs explain why the auth header is forwarded and how to scope it.

---

### P0-3: Chat answers lack robust claim-level citations

**Best-practice violation:** black-box AI, hallucination risk, weak
verification.

**Evidence**

- Chat citations are derived best-effort only from preceding tool messages in
  `src/components/aiChatDrawer/index.tsx:404-463`.
- Citation chips are rendered only for the most recent assistant message in
  `src/components/aiChatDrawer/index.tsx:612-630`.
- Local chat finalization joins summarized tool output in
  `src/utils/ai/chatEngine.ts:49-65`.
- Tool summaries include ids in markdown but not structured claim-to-source
  mappings in `src/utils/ai/chatEngine.ts:210-283`.

**Impact**

The UI has a citation affordance, but it is not strong enough to support
verification of specific claims. Users may see a polished answer and trust it
without knowing which task, member, or column supports each statement.

**Optimization plan**

1. Extend `AiChatMessage` or assistant turn payloads with `citations:
CitationRef[]` and optionally claim spans.
2. Require the remote chat route to return structured citations for factual
   statements.
3. For local mode, emit structured citations directly from tool summaries rather
   than reconstructing them in the drawer.
4. Render citations adjacent to the sentence or bullet they support, not only at
   the end of the latest bubble.
5. Add "Open source task/column/member" behavior to each citation chip.
6. Add a "No sources available" state for answers that are generic or
   heuristic, so absence of citations is explicit.

**Acceptance criteria**

- Every board-data claim in chat has a nearby source or a visible "no source"
  caveat.
- Older assistant messages keep their citations.
- Tests cover citations for list tasks, get task, workload, and unowned-task
  answers.

---

### P1-1: Board brief recommendations lack confidence and source provenance

**Best-practice violation:** uncalibrated recommendations, insufficient
explainability.

**Evidence**

- Board brief displays a headline and recommendation in
  `src/components/boardBriefDrawer/index.tsx:449-462`.
- `IBoardBrief` validation does not include confidence, assumptions, or source
  references in `src/utils/ai/validate.ts:84-106`.
- Local brief recommendations are deterministic heuristics in
  `src/utils/ai/engine.ts:373-470`, but the UI does not label them as such.

**Impact**

Recommendations like "consider reassigning" can feel authoritative even when
they are simple heuristics over current board counts.

**Optimization plan**

1. Add a brief-level "Basis" section:
    - "Based on current task count, column placement, owner, and story points."
    - "Generated just now from local board data" or remote equivalent.
2. Add confidence/strength labels for recommendations:
    - "Strong signal"
    - "Moderate signal"
    - "Low signal / review manually"
3. Add source chips to recommendation cards:
    - unowned tasks,
    - overloaded member workload,
    - large unstarted task.
4. Use "Suggested next step" language instead of implicit command language.

**Acceptance criteria**

- Brief recommendation shows basis, timestamp, and source entities.
- Low-data boards show an explicit low-confidence empty-state explanation.

---

### P1-2: AI search overpromises semantic understanding

**Best-practice violation:** misleading capability framing, hidden uncertainty.

**Evidence**

- UI copy says "Ask Board Copilot a question..." in
  `src/components/aiSearchInput/index.tsx:239-245`.
- Local implementation is deterministic token/Jaccard overlap in
  `src/utils/ai/engine.ts:478-556`.
- Rationale says "Ranked ... by similarity to your phrase" in
  `src/utils/ai/engine.ts:520-525` and
  `src/utils/ai/engine.ts:549-554`.

**Impact**

The feature is useful, but "Ask a question" can imply richer natural-language
understanding than the local engine provides. This risks disappointment for
synonyms, negation, or analytical questions.

**Optimization plan**

1. Rename the input in local mode to a capability-accurate label:
    - "Find related tasks with Copilot"
    - "Describe tasks to filter"
2. Use remote-specific copy only when an actual LLM/embedding service is
   configured.
3. Add visible explanation after first use:
    - "Matched by task names, epics, types, and notes."
4. Add confidence or match quality:
    - "Best match"
    - "Weak match"
    - "No close matches"
5. Improve local matching with a small synonym map for project-management terms
   before investing in a remote embedding service.

**Acceptance criteria**

- Local search copy does not imply broad Q&A.
- Match rationale names fields and match strength.
- No-match state suggests useful alternatives based on detected terms.

---

### P1-3: Feedback controls are too shallow to improve trust or quality

**Best-practice violation:** weak feedback loop, no visible impact of feedback.

**Evidence**

- Chat feedback is only thumbs up/down in
  `src/components/aiChatDrawer/index.tsx:385-397` and
  `src/components/aiChatDrawer/index.tsx:653-686`.
- The remaining v2.1 `track` call sites were wired 2026-05-04: `AGENT_TURN_STARTED` /
  `AGENT_TURN_COMPLETED` in `src/utils/hooks/useAgent.ts`, `AGENT_HEALTH_DEGRADED`
  in `src/utils/hooks/useAgentHealth.ts` (deduped per transition), and
  `COPILOT_REWRITE_ACCEPT` in `src/components/aiTaskAssistPanel/index.tsx`
  (readiness Apply). `AGENT_PROPOSAL_UNDONE` is still unfired because there is
  no FE undo path on accepted proposals. The structured chat-feedback sheet
  described below remains open.
- Feedback toast says only "Thanks for your feedback" via
  `src/constants/microcopy.ts:189-190`.

**Impact**

Users can express dissatisfaction, but cannot say why. Product teams cannot
measure or fix failure categories, and users do not learn whether feedback
affects the current answer, future personalization, or nothing yet.

**Optimization plan**

1. Replace plain thumbs-down with a small feedback sheet:
    - Incorrect
    - Missing source
    - Outdated data
    - Not actionable
    - Unsafe/risky
    - Privacy concern
    - Other
2. For thumbs-up, optionally ask "What worked?" after repeated positive use.
3. Show feedback impact copy:
    - "Feedback is saved for product review."
    - "This does not train the model yet."
    - or "This will personalize future suggestions" if true later.
4. Wire `track` to a privacy-preserving sink before using metrics in
   acceptance criteria.
5. Add a citation-specific "source wrong" flag, since
   `CITATION_FLAGGED` exists but is not wired.

**Acceptance criteria**

- Negative feedback has at least five actionable categories.
- Feedback events include route, surface, category, confidence band, and whether
  citations were present, without raw prompt/output text.
- UI states clearly tell users what feedback changes.

---

### P1-4: Incomplete undo for readiness suggestions can mislead users

**Best-practice violation:** user control, reversible AI actions.

**Evidence**

- Readiness suggestions call `onApplySuggestion` in
  `src/components/aiTaskAssistPanel/index.tsx:194-211`.
- The undo callback is intentionally passive and does not revert the field in
  `src/components/aiTaskAssistPanel/index.tsx:198-209`.

**Impact**

The toast presents an undo surface, but the field stays changed. This violates
the expectation that undo reverses the AI action.

**Optimization plan**

1. Capture previous field values before applying readiness suggestions.
2. Pass previous values into `undoToast.show`.
3. Make undo restore the exact previous value.
4. If a value cannot be restored, do not label the action Undo; use "AI change
   applied" with a "Review field" action instead.

**Acceptance criteria**

- Every visible Undo on an AI-applied field actually reverts the field.
- Tests cover readiness apply + undo for note, epic, type, and coordinator.

---

### P1-5: AI-created bulk tasks use best-effort undo without user-visible partial failure

**Best-practice violation:** rollback clarity, auditability.

**Evidence**

- Bulk breakdown creates tasks sequentially in
  `src/components/aiTaskDraftModal/index.tsx:233-293`.
- Undo deletes created tasks with raw `fetch` and swallows failures in
  `src/components/aiTaskDraftModal/index.tsx:267-287`.

**Impact**

If undo partially fails, users may believe all generated subtasks were removed
when some remain.

**Optimization plan**

1. Route undo deletes through the app API/mutation abstraction so errors are
   normalized.
2. Track deletion outcomes and show:
    - "3 subtasks removed"
    - "2 removed, 1 could not be removed"
3. Add a generated-task audit list with links to created tasks.
4. Add metadata to created tasks if backend supports it:
    - `source: "board-copilot"`
    - `promptHash`
    - `createdByAiAt`

**Acceptance criteria**

- Partial undo failure is visible.
- Users can navigate to generated tasks after bulk creation.
- Bulk creation and undo are covered by tests.

---

### P1-6: AI surfaces are fragmented across too many entry points

**Best-practice violation:** discoverability overload, inconsistent IA,
feature-dump onboarding.

**Evidence**

- Board header exposes Brief, Ask, and settings in
  `src/pages/board.tsx:521-599`.
- AI search is injected into the task filter panel in
  `src/pages/board.tsx:603-619`.
- Draft with AI is in task creation.
- AI assist is inside task editing.
- Command palette has a separate AI mode in
  `src/components/commandPalette/index.tsx:571-578`.
- The PRD already recommends unified AI surface architecture in
  `docs/prd/v3-ai-ux.md:26-34`.

**Impact**

The product has many individually reasonable AI entry points, but the overall
mental model is scattered. Users may not know which Copilot surface to use for a
given task.

**Optimization plan**

1. Consolidate board-level controls into one `Copilot` menu:
    - Ask
    - Brief
    - Find related tasks
    - Draft task
    - Settings
2. Keep context-specific AI affordances inline where they reduce work:
    - task estimate/readiness inside task modal,
    - draft from task creator.
3. Add one right-rail Copilot shell with tabs:
    - Chat
    - Brief
    - Activity/History
    - Settings
4. Make command palette dispatch to the same shell, not a separate mental model.

**Acceptance criteria**

- Board-level AI is reachable from one primary Copilot entry.
- Context-specific inline AI remains near the task it affects.
- First-time onboarding explains the three primary Copilot jobs, not every
  feature.

---

### P1-7: Agentic infrastructure is present but product integration is incomplete

**Best-practice violation:** half-wired AI affordances, unclear autonomy,
future overautomation risk.

**Evidence**

- `MutationProposalCard` is **gated off by default** as of `5d96e16` behind `environment.aiMutationProposalsEnabled` (`REACT_APP_AI_MUTATION_PROPOSALS_ENABLED`, default `false`). The card does not render even when an agent emits a `pendingProposal`. This is a v2.1 mitigation that closes the customer-visible "Accept does nothing" path; the full lifecycle remains unimplemented (see `../status/production-readiness.md` §1). `NudgeCard` is unaffected by the flag.
- `MutationProposalCard` and `NudgeCard` are wired into `AiChatDrawer` with
  accept/reject/action/dismiss callbacks; local-dismiss fallback covers the
  case where no owner callback is supplied.
- `useAgent` and `streamAgent` are in production use: `AiChatDrawer` uses
  `useAgentChat` (wrapping `useAgent("chat-agent")`) in remote builds, and the
  triage agent runs in `board.tsx` once per project per session.
- `custom/suggestion` SSE events are now surfaced via `lastSuggestion` /
  `clearSuggestion` on `UseAgentResult` (was dark code; landed `5ce8d95`).
- An Ant Design `Select` autonomy selector (Suggest / Plan / Auto) is now
  rendered in the `AiChatDrawer` extra slot, wired to `useAutonomyLevel` setter
  (landed `5ce8d95`). `autonomyRef` in `useAgent` now tracks the persisted
  setting; it was previously hard-coded to `"plan"`.
- Write tools remain disabled; the governance gap is that a proposal-undo
  surface and an agent activity log do not yet exist.

**Impact**

The agentic surface is no longer pure scaffolding, but the absence of an
activity log and proposal-undo path means users cannot audit or reverse agent
actions taken in the current session. This remains an open risk if write tools
are enabled in a future phase.

**Optimization plan**

1. Keep agent write tools disabled until a complete "Copilot Activity" or
   "Review proposals" surface exists.
2. ~~Define autonomy levels in UI before enabling write tools~~ — done: Suggest
   / Plan / Auto selector is mounted and persisted (`5ce8d95`). Next step is
   honoring `suggest` to suppress write proposals end-to-end.
    - Suggest only
    - Propose changes
    - Apply with confirmation
3. Mutation proposals must include:
    - source data,
    - diff,
    - risk,
    - undoability,
    - why this is suggested,
    - exact affected records.
4. Add an agent activity log before write tools:
    - started,
    - tool called,
    - proposal shown,
    - accepted/rejected,
    - undone,
    - failed.
5. Add red-team tests for prompt injection and disallowed write attempts.

**Acceptance criteria**

- No agentic write proposal appears outside a reviewable proposal surface.
- Every proposal has accept/reject and risk copy.
- Activity log can explain what happened after the fact.

---

### P2-1: Confidence is inconsistent across surfaces

**Best-practice violation:** inconsistent trust calibration.

**Evidence**

- Confidence bands are defined in `src/utils/ai/confidenceBand.ts:1-41`.
- Draft modal uses confidence in
  `src/components/aiTaskDraftModal/index.tsx:491-508`.
- Task estimate uses confidence in
  `src/components/aiTaskAssistPanel/index.tsx:274-388`.
- Chat and brief do not expose confidence/basis at answer level.
- Search does not expose match confidence, only rationale.

**Optimization plan**

1. Define a shared `AiConfidenceIndicator` component.
2. Use it on:
    - draft suggestions,
    - estimates,
    - search results,
    - brief recommendations,
    - future mutation proposals.
3. Do not force confidence onto every chat answer. For chat, use confidence only
   for factual board-data answers or when sources are thin.
4. Add guidance:
    - high confidence: normal CTA,
    - moderate: normal CTA plus "review",
    - low: secondary CTA "Apply anyway" or ask clarification.

**Acceptance criteria**

- Every structured AI recommendation has a confidence/basis indicator.
- Numeric percentages never appear without a plain-language band.

---

### P2-2: Collapsed tool details still expose internal ids and implementation framing

**Best-practice violation:** explanations should support user decisions, not
technical completeness.

**Evidence**

- Tool details render summaries and expandable content in
  `src/components/aiChatDrawer/index.tsx:536-556`.
- Tool summaries include raw ids in `src/utils/ai/chatEngine.ts:218-270`.

**Impact**

The current collapse is much better than raw JSON by default, but expanded
details still emphasize ids and tool names rather than user-relevant evidence.

**Optimization plan**

1. Rename "Looked up List tasks" style summaries to plain-language evidence:
    - "Checked 12 tasks"
    - "Checked board columns"
    - "Opened task: Fix login redirect"
2. Replace raw ids with linked display labels when possible.
3. Put raw diagnostics behind a second "Developer details" disclosure in dev
   builds only.

**Acceptance criteria**

- Default and first-level expanded tool details are understandable to non-
  technical users.
- Raw ids are available only when they help disambiguate or debug.

---

### P2-3: AI copy still uses first-person error language in one path

**Best-practice violation:** avoid anthropomorphism that inflates trust or
emotional framing.

**Evidence**

- `microcopy.ai.chatErrorRecovery` says "I couldn't find an answer..." in
  `src/constants/microcopy.ts:220-221`.
- The project otherwise documents tool-like language in
  `src/constants/microcopy.ts:161-166`.

**Optimization plan**

Change to neutral copy:

```text
Board Copilot could not find an answer. Try rephrasing, or check the sources it reviewed.
```

Then run a microcopy audit for `I `, `I'm`, `I think`, `I understand`, and
similar first-person phrases in AI surfaces.

**Acceptance criteria**

- AI system copy is consistently neutral and tool-like.
- Tests/lint prevent new anthropomorphic AI phrases.

---

### P2-4: AI search and command palette share overlapping mental models

**Best-practice violation:** confusing affordances.

**Evidence**

- AI search says "Ask Board Copilot a question..." in
  `src/components/aiSearchInput/index.tsx:239-245`.
- Command palette AI mode says "Ask Board Copilot..." in
  `src/components/commandPalette/index.tsx:488-491` and
  `src/components/commandPalette/index.tsx:571-578`.
- One path filters tasks/projects; the other opens chat.

**Impact**

The same "Ask Board Copilot" language leads to different outcomes: filtering vs
chat response.

**Optimization plan**

1. Reserve "Ask Board Copilot" for chat.
2. Rename AI search to "Find related tasks" / "Find related projects".
3. In command palette, show explicit action:
    - "Ask Copilot in chat"
4. Add helper text under AI search:
    - "Filters this list; it will not open a chat."

**Acceptance criteria**

- The same verb does not trigger different interaction models.
- Users can predict whether an AI action will filter, draft, summarize, or chat.

---

### P2-5: Observability sinks + call sites wired

**Resolved (2026-05-04, two-phase):**

Phase 1 — sinks landed: `src/utils/observability/sinks.ts` exports
`httpAnalyticsSink`, `httpErrorSink`, and `devMemorySink`. Wired from
`src/index.tsx` via `VITE_ANALYTICS_ENDPOINT` / `VITE_ERROR_REPORT_ENDPOINT`.
`ErrorBoundary.componentDidCatch` now reports to the error sink. Every analytics
event includes `engineMode: "local" | "remote"`.

Phase 2 — call sites wired: every event in `ANALYTICS_EVENTS` now has at least
one production fire site, with the single exception called out below.
`AGENT_TURN_STARTED` / `AGENT_TURN_COMPLETED` (with `agentName`, `durationMs`,
`tokensIn`, `tokensOut`) fire from `src/utils/hooks/useAgent.ts` on stream open
and natural completion / terminal error (aborts skip `COMPLETED`).
`AGENT_HEALTH_DEGRADED` fires once per transition into `degraded` / `offline`
from `src/utils/hooks/useAgentHealth.ts`, deduped via a ref so a sustained
degraded status does not spam the sink. `COPILOT_REWRITE_ACCEPT` fires from
`src/components/aiTaskAssistPanel/index.tsx` when the user clicks Apply on a
readiness suggestion (the "rewrite" surface; estimate Apply continues to fire
its own `COPILOT_ESTIMATE_APPLY`). `AGENT_TTFT`, `CITATION_CLICKED`, and
`CITATION_FLAGGED` were already firing pre-2026-05-04; they continue unchanged.

**Still open**

- `AGENT_PROPOSAL_UNDONE` is defined but unfired: there is no UI path that
  undoes a previously accepted `MutationProposal`. `MutationProposalCard` has
  Accept / Reject only. When a proposal-undo surface is built (Phase B
  follow-up), the call site lands alongside it.
- The sinks need an upstream consumer (Segment, PostHog, in-house). Until
  `VITE_ANALYTICS_ENDPOINT` is set in production builds the events fall through
  to `devMemorySink` (inspect via `window.__copilotEvents__` in the console).
  **As of `5d96e16`:** production builds now emit a `console.warn` at startup for
  each missing endpoint var (`VITE_ANALYTICS_ENDPOINT`, `VITE_ERROR_REPORT_ENDPOINT`),
  surfacing the silent-drop risk visibly. Warnings are also available at
  `window.__copilotObservabilityWarnings__` for smoke tests.

**Verification**

1. `track()` call sites are forwarded to the active sink via `setAnalyticsSink`
   in `src/index.tsx`.
2. Analytics payload review (`src/constants/analytics.ts` + each call site)
   confirms no raw prompts, notes, task names, or generated answers are emitted —
   only ids, counts, durations, and enum status values.
3. `devMemorySink` is the default in development (`window.__copilotEvents__`).

---

### P2-6: The local deterministic engine is branded like full AI

**Best-practice violation:** capability mismatch, inflated expectations.

**Evidence**

- `environment.aiUseLocalEngine` defaults to true when no AI base URL is set in
  `src/constants/env.ts:12-20`.
- Local behavior is deterministic rules/Jaccard in `src/utils/ai/engine.ts`.
- UI still uses full Board Copilot branding across all modes.

**Impact**

Local mode is valuable for demos and offline behavior, but users may attribute
rule-based mistakes to "AI" and lose trust.

**Optimization plan**

1. In development/local mode, label as "Board Copilot preview" or "Local
   Copilot rules".
2. In production local mode, explain limitations in the privacy/capability
   popover:
    - "Uses deterministic project rules; no external model is configured."
3. Keep the same surface, but calibrate expectations by mode.

**Acceptance criteria**

- Users can distinguish local deterministic behavior from remote AI behavior.
- Support/debug screenshots reveal which mode is active.

---

## 5. Recommended target architecture

### 5.1 Unified Copilot surface

Move toward one right-rail Copilot shell:

- **Chat**: conversational Q&A with sources.
- **Brief**: board summary and recommendations.
- **Activity**: generated drafts, applied suggestions, undoable actions,
  feedback status.
- **Settings**: data scope, local/remote mode, project enablement, privacy.

Keep inline AI where the user is already working:

- Task draft from task creator.
- Estimate/readiness inside task edit.
- Suggested badges next to fields.
- AI search as a filter affordance, but rename it to clarify behavior.

### 5.2 Trust model

Every AI output should declare:

1. **What it is**: answer, draft, estimate, search filter, recommendation,
   proposal.
2. **What it used**: board fields, notes, members, columns, current task, prompt.
3. **How certain it is** when structured enough to know.
4. **What the user can do**: accept, edit, reject, undo, retry, check sources,
   flag issue.

### 5.3 Data governance model

Introduce route-level payload builders:

```text
buildAiPayload(route, rawContext, dataScopeSettings) -> sanitizedPayload
```

This avoids each component deciding independently what to send.

Add tests for:

- included fields,
- excluded fields,
- project disable,
- remote vs local disclosure,
- auth behavior.

---

## 5.A Resolved items

The following items from Phases 1–3 have shipped as of 2026-05-05.

### Phase 1 shipped items

- **Privacy copy vs. payload alignment (partial):** `src/constants/microcopy.ts` updated so the "What is shared?" copy no longer claims task notes are never shared in surfaces that do send them. `CopilotPrivacyPopover` updated with local-vs-remote processing context (P0-1 partial).
- **Local vs. remote disclosure (P0-2):** `CopilotPrivacyPopover` now surfaces the processing-mode context. Local mode describes deterministic in-app rules; remote mode names the configured AI service origin.
- **AI search rename (P1-2):** `AiSearchInput` copy changed from "Ask Board Copilot a question..." to "Find related tasks/projects" with helper text clarifying the action filters the current list and does not open chat.
- **Neutral error copy (P2-3):** `microcopy.ai.chatErrorRecovery` and `chatEngine.ts` rewritten to tool-like neutral language; first-person "I couldn't find an answer" replaced.
- **Readiness Undo (P1-4):** `aiTaskAssistPanel` and `taskModal` now capture previous field values before applying readiness suggestions and restore them on Undo, rather than showing a passive no-op toast.

### Phase 2 shipped items

- **Agentic surface P1-7 (partial):** `MutationProposalCard` and `NudgeCard` wired into `AiChatDrawer` with accept/reject/action/dismiss callbacks. `useAgent` and `streamAgent` in production use. `custom/suggestion` SSE events surfaced via `lastSuggestion`/`clearSuggestion` on `UseAgentResult`. Autonomy selector (Suggest/Plan/Auto) mounted and persisted in `AiChatDrawer`.

### Phase 3 shipped items (observability sinks P2-5)

- **Observability sinks:** `src/utils/observability/sinks.ts` exports `httpAnalyticsSink`, `httpErrorSink`, `devMemorySink`; wired from `src/index.tsx` via `VITE_ANALYTICS_ENDPOINT`/`VITE_ERROR_REPORT_ENDPOINT`. `ErrorBoundary.componentDidCatch` reports to error sink.
- **Observability call sites:** `AGENT_TURN_STARTED`/`AGENT_TURN_COMPLETED` (with `agentName`, `durationMs`, `tokensIn`, `tokensOut`) fire from `useAgent.ts`. `AGENT_HEALTH_DEGRADED` fires once per transition from `useAgentHealth.ts`. `COPILOT_REWRITE_ACCEPT` fires from `aiTaskAssistPanel` on readiness Apply. `AGENT_TTFT`, `CITATION_CLICKED`, `CITATION_FLAGGED` already firing.
- **Resolved (2026-05-05):** `AGENT_PROPOSAL_UNDONE` now fires. `MutationProposalCard` implements a 10-second countdown phase: accept defers `onAccept`, shows "Undo (Xs)" + field-change summary, fires `AGENT_PROPOSAL_UNDONE` analytics on undo, and commits only when countdown reaches zero. See `src/components/mutationProposalCard/index.tsx`.

### Phase 4 shipped items — Surface consolidation (2026-05-05)

- **Unified Copilot entry point (P1-A):** `CopilotMenu` Ant Design dropdown added to board header with items: Ask, Brief, Find related tasks, Draft task, Settings. Resolves the ≥5 fragmented entry-point problem.
- **Right-rail Copilot shell (P1-A):** `src/components/copilotShell/index.tsx` — tabbed Drawer with Chat / Brief / Activity / Settings tabs. Chat and Brief tabs open their respective existing drawers; Activity tab placeholder for agent turn history.
- **Command palette routing (P1-A + P3-A):** AI mode in command palette routes to `onOpenCopilot` callback to open the Copilot shell Chat tab with the query pre-filled. No-results state (≥3 chars) shows "Try asking Board Copilot →" CTA.

### Phase 5 shipped items — Agentic readiness (2026-05-05)

- **Proposal-undo surface (P1-B):** `MutationProposalCard` now shows: what fields will change, risk level, "10s undo available after accepting" footer hint. Accept triggers a 10-second countdown with an "Undo (Xs)" button; `AGENT_PROPOSAL_UNDONE` fires on undo. `MutationProposalCard` remains gated behind `aiMutationProposalsEnabled` — the flag gate is unchanged; only the UX quality of the accept/undo path is improved.
- **Context-window safety (P1-C):** `AiChatDrawer` derives approximate token count from message character lengths; shows a dismissible warning at ≥6 000 tokens and a persistent error alert with "Start new" action at ≥7 500 tokens. `AgentBudgetError` now preserves the user's submitted message in the input field instead of discarding it. "New Conversation" button now shows a `Modal.confirm` if history exists.
- **TTFT SLO (P2-I):** `TTFT_SLO_MS = 1500` defined in `useAgent.ts`; `AGENT_TTFT_SLOW` fires when exceeded. `AiChatDrawer` shows "Still thinking…" annotation alongside the Skeleton bubble when TTFT exceeds 3 seconds.

### Other items shipped — Accessibility & Streaming UX (2026-05-05)

- **P2-A:** Interim `role="status" aria-live="polite"` region announces "Board Copilot is responding." on stream start; clears on completion (completion word-count announcement unchanged).
- **P2-B:** `lastAssistantRef` attached to the last rendered assistant message; focused (`tabIndex={-1}`) after stream completes. Escape key on the messages container re-focuses the input.
- **P2-C:** "Sessions are not saved — history clears on reload." notice in empty-chat state (Phase A). `saveChatHistory` / `loadChatHistory` added to `projectAiStorage.ts`; history is persisted to `localStorage` on every message change (Phase B save; restore on open deferred to Phase C).
- **P2-D:** Scroll-to-bottom FAB ("↓ Jump to latest") appears when user scrolls up more than 100px during streaming; auto-hides within 50px of bottom.
- **P2-E:** Assistant messages with >300 words of continuous prose are collapsed to the first 150 words with a "Show full response" expand button.
- **P2-F:** `CopilotAboutPopover` component (`src/components/copilotAboutPopover/index.tsx`) — `InfoCircleOutlined` trigger button opens a popover with capability list, limitations, model info (local vs remote), and knowledge cutoff.
- **P2-G:** `useAgentHealth()` wired into `AiChatDrawer`; inline `Alert` shown when status is `degraded` (warning) or `offline` (error); Send button disabled when offline.
- **P2-H:** `AiChatDrawer` body `paddingBottom` updated to `max(${space.md}px, env(keyboard-inset-height, 0px), env(safe-area-inset-bottom))` for mobile soft-keyboard safety.
- **P3-B:** `renderMarkdown()` helper applied to all assistant message content — handles headings, bold, italic, inline code, and newlines progressively on every streaming chunk.
- **P3-C:** `CopyOutlined` button added to assistant message action bar; strips markdown syntax before writing to clipboard, shows "Copied" toast.
- **P3-D:** `EditOutlined` button on user message bubbles re-fills the input field and focuses the textarea.
- **P3-E:** `maxLineLengthCh` token (`75ch`) applied to expanded-terms and rationale prose containers in `aiSearchInput/index.tsx`.

---

## 6. Phased roadmap

### Phase 1 — Trust and privacy corrections — Status: Complete

1. Fix route-specific privacy copy and note-disclosure mismatch.
2. Add local vs remote processing disclosure.
3. Rename AI search to avoid implying chat/Q&A.
4. Replace first-person AI error copy.
5. Make readiness Undo actually revert fields.

### Phase 2 — Evidence and calibration — Status: Complete

1. Add structured citations to chat payloads and UI.
2. Add source/basis section to board brief recommendations.
3. Create shared `AiConfidenceIndicator`.
4. Add match quality to AI search.
5. Replace tool summaries with user-facing evidence summaries.

### Phase 3 — Feedback and observability — Status: Complete

1. Implement privacy-preserving analytics sink.
2. Expand feedback categories.
3. Wire citation clicked/flagged events.
4. Add trust-calibration dashboard metrics for internal QA.
5. Measure stop, retry, regenerate, apply-anyway, and undo rates.

### Phase 4 — Surface consolidation — Status: Complete (2026-05-05)

1. ✅ Consolidate board-level AI controls into one Copilot menu (`CopilotMenu` dropdown on board header).
2. ✅ Build right-rail Copilot shell with Chat / Brief / Activity / Settings (`src/components/copilotShell/`).
3. ✅ Route command palette AI mode into the shell (via `onOpenCopilot` callback).
4. ✅ Add action history placeholder in Activity tab; full turn log deferred to Phase 6.

### Phase 5 — Agentic readiness — Status: Complete (FE side, 2026-05-05)

1. ✅ Agent write tools remain disabled (flag gate `aiMutationProposalsEnabled` unchanged).
2. ✅ `MutationProposalCard` now has a full 10-second undo surface, field-change disclosure, and `AGENT_PROPOSAL_UNDONE` analytics. Re-enable flag only after BE `fe.applyMutation` lifecycle ships.
3. `NudgeCard` inbox integration deferred to Phase 6 (BE-gated).
4. ✅ Autonomy selector present; "Auto" hard-disabled with explanatory tooltip until preapproved-tool schema lands.
5. Prompt-injection and disallowed-action red-team tests deferred to QA sprint.

---

## 7. Test and validation plan

### Static/unit tests

- Privacy copy matches actual route payload fields.
- Remote payload sanitization excludes forbidden fields.
- Project disable prevents every AI route.
- Readiness suggestion undo restores previous field values.
- Confidence indicator renders band + percentage for structured outputs.
- Chat citations persist per assistant message.
- Feedback categories emit safe analytics payloads.

### Integration tests

- Board: open Copilot menu, ask chat, inspect citations, send feedback.
- Board: run AI search, inspect match rationale, clear semantic filter.
- Task modal: edit fields, apply estimate, undo, apply readiness, undo.
- Draft modal: generate task, edit AI field, badge clears, create task.
- Brief: generate, refresh, inspect sources, copy markdown.

### Accessibility tests

- `jest-axe` for every AI component — **resolved 2026-05-04**: 31 axe tests added in
  `src/__tests__/aiAccessibility.strict.test.tsx` covering AiChatDrawer (3 states),
  AiTaskAssistPanel, BoardBriefDrawer, AiTaskDraftModal, AiSearchInput, NudgeCard (3
  severities), MutationProposalCard, CommandPalette, EngineModeTag, CitationChip (4
  sources), AiMatchStrengthBadge. Real WCAG 4.1.2 violation in `AiMatchStrengthBadge`
  compact mode fixed (`role="img"` added).
- Keyboard-only flow:
    - open command palette,
    - switch to Copilot mode,
    - ask prompt,
    - stop generation,
    - regenerate,
    - provide feedback.
- Screen-reader live-region checks for chat, search, brief, and task assist.
- Reduced-motion checks for streaming cursor and loading states.

### Runtime/manual checks

- Local mode and remote mode privacy copy.
- Mobile drawer/bottom-sheet behavior.
- Long task names and long generated notes.
- No-data boards.
- Low-confidence estimates.
- Remote timeout, 429, 500, and network failure states.

---

## 8. Source mapping to AI UX best practices

| Best practice / red flag          | Current status                             | Plan sections     |
| --------------------------------- | ------------------------------------------ | ----------------- |
| Visible AI involvement            | Mostly strong                              | Preserve; 3.1     |
| User control / undo               | Good but uneven                            | P1-4, P1-5        |
| Privacy and data-use clarity      | Needs correction                           | P0-1, P0-2        |
| Claim-level verification          | Partial                                    | P0-3, P1-1        |
| Confidence calibration            | Partial                                    | P2-1              |
| Avoid misleading affordances      | Needs copy cleanup                         | P1-2, P2-4        |
| Feedback loops                    | Too shallow                                | P1-3, P2-5        |
| Graceful failure                  | Mostly good                                | Continue in tests |
| Avoid anthropomorphism            | Mostly good                                | P2-3              |
| Avoid half-wired agentic features | Needs governance                           | P1-7, Phase 5     |
| Accessibility of dynamic AI UI    | jest-axe done (2026-05-04)                 | Test plan         |
| Measurement and monitoring        | Sinks + v2.1 call sites wired (2026-05-04) | P2-5              |

---

## 9. Definition of done

The AI UX optimization work is complete when:

1. Users can see what Board Copilot is doing, what data it used, and whether it
   ran locally or remotely.
2. Every structured AI recommendation has confidence or basis copy.
3. Every factual chat answer has source citations or an explicit no-source
   caveat.
4. Every visible AI Undo actually reverses the action or is renamed to avoid a
   false promise.
5. AI search, chat, draft, brief, and task assist use distinct labels that match
   their outcomes.
6. Feedback captures actionable categories without sending raw private content.
7. No agentic write action can ship without preview, risk, accept/reject, undo,
   and audit history.
8. Accessibility tests cover dynamic AI states.
9. Local and remote modes have separate, accurate privacy and capability
   disclosures.
10. Analytics can measure trust-calibration signals without leaking task/user
    content. Production builds warn at startup when `VITE_ANALYTICS_ENDPOINT`
    or `VITE_ERROR_REPORT_ENDPOINT` is unset so silent event-drop is never
    invisible (as of `5d96e16`; see P2-5).
