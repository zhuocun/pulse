# UX Improvement Plan — 2026-05-05

**Scope**: jira-react-app ("Board Copilot")
**Based on**: Fresh audit against Anthropic, Nielsen Norman Group, WCAG 2.2, aiuxdesign.guide, Smashing Magazine, Redis/streaming-LLM, and industry AI-UX criteria. Cross-referenced with `AI_UX_OPTIMIZATION_PLAN.md` (existing plan, Phases 1–3 resolved) and `docs/ui-ux-optimization-plan.md`.

---

## 1. What is already resolved

The following best-practice areas are **implemented and should not be regressed**:

| Area | Evidence in codebase |
|---|---|
| Stop / Regenerate controls in chat | `aiChatDrawer/index.tsx:646-686`, `818-836` |
| Sample prompt chips in empty chat | `aiChatDrawer/index.tsx:514-534` |
| Follow-up prompt chips after turns | `aiChatDrawer/index.tsx:692-715` |
| Draft modal sample prompts | `aiTaskDraftModal/index.tsx:377-389` |
| Token-by-token SSE streaming with blinking cursor | `agentClient.ts`, `StreamingCursor` |
| `aria-live="off"` during streaming + word-count announcement on completion | `aiChatDrawer` live-region wiring |
| Thumbs-up/down + 7-category negative feedback + thanks toast | `aiFeedbackPopover/index.tsx` |
| Typed AI error hierarchy with user-facing copy | `agentErrors.ts` + `microcopy.ai` |
| Rate-limit countdown timer | `aiChatDrawer`, `disabledForSeconds` |
| Optimistic updates + 10-second undo toast | `useUndoToast`, `optimisticUpdate/*` |
| MutationProposalCard accept/reject (gated) | `mutationProposalCard/index.tsx` |
| Autonomy selector (Suggest / Plan / Auto) | `aiChatDrawer` extra slot, `useAutonomyLevel` |
| AI attribution + "AI · review before using" disclaimer | `aiChatDrawer/index.tsx:632-635` |
| Privacy copy aligned to payloads (local vs remote) | Phase 1 complete |
| Readiness Undo actually reverts field | Phase 1 complete |
| Observability sinks wired | `observability/sinks.ts`, Phase 3 complete |
| Board loading skeleton matching real column layout | `board.tsx:230-247` |
| Full accessibility stack (skip link, focus rings, ARIA live regions, jest-axe) | Multiple components |
| Responsive design (mobile scroll-snap, bottom-sheet palette, touch targets 44px) | `board.tsx`, `commandPalette`, `appProviders` |

---

## 2. Open gaps — ranked by importance

Severity: **P1** = critical / broken UX · **P2** = meaningful gap · **P3** = polish

---

### P1-A · Phase 4 (existing plan): Unified Copilot surface — fragmented entry points

**Gap**: Board-level AI is reachable from ≥ 5 independent entry points (board header Brief button, board header Ask button, AI search in filter panel, command palette AI mode, task-modal assist panel). Users cannot build a coherent mental model of what "Copilot" is for.

**Why it matters**: Nielsen Heuristic 4 (Consistency & Standards), NN/G fragmented-AI discoverability research.

**Solution**:
1. Consolidate board-level controls into one `<CopilotMenu>` dropdown off the board header — entries: Ask, Brief, Find related tasks, Draft task, Settings.
2. Build a right-rail Copilot shell (`src/components/copilotShell/`) with tabs: **Chat** · **Brief** · **Activity** · **Settings**.
3. Route command palette AI mode (`/` trigger) to open the same shell's Chat tab, not a separate mental model.
4. Keep *inline* AI where it reduces work: task estimate/readiness inside task modal, draft from task creator.

**Files**: `src/pages/board.tsx:521-599`, `src/components/commandPalette/index.tsx:571-578`, `docs/prd/board-copilot-v3.md:26-34`

---

### P1-B · Phase 5 (existing plan): Agentic write tools blocked — proposal-undo and activity log missing

**Gap**: `MutationProposalCard` is gated off by default (`aiMutationProposalsEnabled = false`). Agent write tools cannot ship until a proposal-undo surface and an activity log exist. `AGENT_PROPOSAL_UNDONE` analytics event is defined but unfired — no UI undo path on accepted proposals.

**Why it matters**: Anthropic agent-safety framework; NIST AI RMF — users must be able to audit and reverse agentic actions.

**Solution**:
1. Build a **Copilot Activity** tab inside the Copilot shell (see P1-A): list of agent turns → proposals shown → accepted/rejected → undo available.
2. Add undo to `MutationProposalCard`: capture pre-acceptance field values, expose "Undo" within the 10-second window, fire `AGENT_PROPOSAL_UNDONE`.
3. Each proposal card must show: what changed, what data was used, risk level, undo availability.
4. Only then enable `aiMutationProposalsEnabled` in production.
5. Add red-team tests for prompt injection and disallowed write attempts.

**Files**: `src/components/mutationProposalCard/index.tsx`, `src/utils/hooks/useAgent.ts`, `src/constants/analytics.ts` (`AGENT_PROPOSAL_UNDONE`), `docs/PRODUCTION_READINESS.md §1`

---

### P1-C · NEW: No context-window limit warning before `AgentBudgetError` fires

**Gap**: Users receive no warning as the conversation approaches the token limit. The `AgentBudgetError` error fires after the limit is hit, at which point the user's message is lost and recovery options are unclear.

**Why it matters**: Conversation & context management best practice — warn users *before* the limit, not after; preserve user input on error.

**Solution**:
1. Track approximate token count in `useAiChat` or `useAgentChat` (count characters × ~0.25 as a conservative estimate, or receive a `usage` field in SSE chunks).
2. At ≥ 75% of estimated budget: show a dismissible inline banner in the chat drawer — "This conversation is getting long. Consider starting a new session to maintain response quality."
3. At ≥ 95%: show a persistent warning with a "Start new conversation" CTA.
4. On `AgentBudgetError`: preserve the user's submitted message in the input field, show a clear recovery panel — "Conversation too long. [Start new] or [Summarize & continue]."
5. Add a "New conversation" button (`src/components/aiChatDrawer/`) in the drawer header, with a confirmation dialog if history will be lost.

**Files**: `src/components/aiChatDrawer/index.tsx`, `src/utils/hooks/useAiChat.ts`, `src/utils/ai/agentErrors.ts`

---

### P2-A · NEW: No screen-reader interim status during AI streaming

**Gap**: `aria-live="off"` during streaming is correct (prevents mid-word floods) but leaves screen reader users with no signal that the AI is working. The only announcement is the word count on completion. A keyboard/AT user submits a prompt and hears silence until the response is done.

**Why it matters**: WCAG 4.1.3 Status Messages; ARIA best practices for AI interfaces — "AI is responding…" is a status message that must be reachable without focus.

**Solution**:
1. When streaming begins (first SSE chunk received), announce via a `role="status" aria-live="polite"` region: "Board Copilot is responding."
2. Keep the streaming container `aria-live="off"` (unchanged).
3. On stream completion, replace the interim announcement with the word-count summary: "Board Copilot responded. 142 words."
4. On stream abort/error, announce: "Board Copilot stopped. Response incomplete."

**Files**: `src/components/aiChatDrawer/index.tsx` (streaming live-region wiring)

---

### P2-B · NEW: Focus not managed after AI response renders in chat

**Gap**: After an AI response appears in the chat drawer, keyboard focus remains on the input field (or wherever it was). Users navigating by keyboard must Tab through the entire response to reach action buttons (copy, feedback). For long responses this is a significant barrier.

**Why it matters**: WCAG 2.4.3 Focus Order; NN/G keyboard accessibility for AI interfaces.

**Solution**:
1. After the streaming cursor disappears (stream complete), programmatically move focus to a visually hidden "skip to response" link anchored just above the new assistant message.
2. The link reads "New Copilot response — press Enter to read" and moves focus to the response container on activation.
3. Alternatively: add a `tabIndex={-1}` ref on the assistant message container and focus it after stream end.
4. Ensure the input field is re-focused when the user presses Escape from the response area, preserving the "reply" flow.

**Files**: `src/components/aiChatDrawer/index.tsx`

---

### P2-C · NEW: Conversation history not persisted across sessions

**Gap**: The AI chat drawer likely resets on page reload or session expiry. Users cannot resume a board conversation from a previous session, and there is no history browser or session list.

**Why it matters**: Conversation & context management best practice — history must be persisted or the product must clearly communicate that it is not.

**Solution (phased)**:
- **Phase A (fast)**: Add a visible "Sessions are not saved — history clears on reload" notice inside the empty chat state or drawer footer. This sets accurate expectations without new infrastructure.
- **Phase B**: Persist conversation history to `localStorage` keyed by `projectId + userId`. Cap at 50 turns per project to avoid unbounded storage. Load on drawer open.
- **Phase C (future)**: Persist to the backend alongside other project data so history is cross-device and searchable.

**Files**: `src/components/aiChatDrawer/index.tsx`, `src/utils/ai/projectAiStorage.ts`

---

### P2-D · NEW: No scroll-to-bottom affordance when user scrolls up during streaming

**Gap**: If a user scrolls up while the AI is streaming a long response, there is no floating button to jump back to the live content. The user must manually scroll down to see new tokens appearing.

**Why it matters**: Streaming-UX best practice; especially critical on mobile where one-thumb scrolling and small viewports make this a common state.

**Solution**:
1. Track scroll position in the chat messages container with a `scroll` event listener.
2. When the user has scrolled more than 100px above the bottom *and* streaming is active, show a `position: absolute; bottom: 72px` FAB: "↓ Jump to latest".
3. On click: `scrollIntoView({ behavior: "smooth" })` on the streaming message, then hide the FAB.
4. Auto-hide the FAB when the user is within 50px of the bottom.

**Files**: `src/components/aiChatDrawer/index.tsx`

---

### P2-E · NEW: Long AI responses lack progressive disclosure (summary-first)

**Gap**: The chat drawer renders the full AI response as continuous prose or markdown. Long responses (>300 words) become walls of text with no visual hierarchy cue to help users scan before reading in full.

**Why it matters**: NN/G — "Design responses that are direct, scannable, and easy to expand"; progressive disclosure best practice for AI outputs.

**Solution**:
1. After streaming completes, detect response length. If > 300 words and the response contains markdown headers or bullet points: render normally (markdown structure itself provides hierarchy).
2. If > 300 words and the response is continuous prose: add a "Show full response" collapse, keeping the first 150 words visible by default.
3. Alternatively: prompt the AI (system prompt or post-processing) to use bullet points or a TL;DR line for long answers — this is higher-leverage than a UI collapse.
4. For `boardBriefDrawer`: already has a recommendation card structure — ensure each card has a one-sentence headline before the detail body.

**Files**: `src/components/aiChatDrawer/index.tsx`, `src/components/boardBriefDrawer/index.tsx`

---

### P2-F · NEW: No proactive AI-capabilities / knowledge-cutoff disclosure

**Gap**: There is no "About Board Copilot" or model card surface. Users have no way to learn the AI's knowledge cutoff, training data scope, what it is optimized for, or who the underlying model provider is when in remote mode.

**Why it matters**: Anthropic Transparency Hub guidance; NN/G "site chatbots clearly state their purpose"; EU AI Act transparency requirement.

**Solution**:
1. Add a `CopilotAboutPopover` component (or extend `CopilotPrivacyPopover`) with:
   - "What can Board Copilot help with?" — bullet list of primary tasks.
   - "What it cannot do" — explicit scope limits.
   - In remote mode: model provider name (from `REACT_APP_AI_BASE_URL` origin or a config field).
   - Knowledge cutoff date (hardcoded or config-driven).
2. Surface the "?" info icon in the Copilot drawer header, linking to this popover.
3. When AI declines a request (content policy, out-of-scope): the decline message should name the reason in plain language and point to the About popover.

**Files**: new `src/components/copilotAboutPopover/index.tsx`, `src/components/aiChatDrawer/index.tsx`, `src/constants/env.ts`

---

### P2-G · NEW: Service-degradation banner too subtle — `AgentHealthBadge` is a small dot

**Gap**: `AgentHealthBadge` is an 8px status dot in the header, only visible when AI is degraded or offline. Users who are not watching the header will encounter silent AI failures without explanation.

**Why it matters**: Error handling best practice — circuit-breaker state should be communicated via a banner, not just a status dot in a non-central location.

**Solution**:
1. Keep `AgentHealthBadge` in the header as a persistent indicator.
2. When status transitions to `degraded` or `offline`: show a dismissible `<Alert type="warning">` at the top of the `AiChatDrawer` — "Board Copilot is experiencing delays. Responses may be slow or unavailable."
3. For `offline`: change alert to `type="error"` with "Board Copilot is currently unavailable. Try again later." Disable the submit button while offline.
4. Auto-dismiss the alert (without user action) when health returns to `ok`.

**Files**: `src/components/aiChatDrawer/index.tsx`, `src/utils/hooks/useAgentHealth.ts`, `src/components/header/index.tsx`

---

### P2-H · NEW: Mobile — AI chat input may be obscured by soft keyboard

**Gap**: The `AiChatDrawer` uses `height="80dvh"` (or similar) as a bottom drawer on mobile. When the soft keyboard opens on the chat input, the input may scroll behind the keyboard, requiring the user to scroll to find it. The auth layout correctly uses `env(safe-area-inset-*)` but the chat drawer has not been confirmed to handle `env(keyboard-inset-height)`.

**Why it matters**: Mobile AI UX best practice — the input area must stay visible above the keyboard at all times.

**Solution**:
1. Add `padding-bottom: env(keyboard-inset-height, 0px)` to the chat drawer's inner scroll container.
2. On iOS Safari: listen to `window.visualViewport.resize` events to adjust the drawer's bottom offset dynamically.
3. Add a manual smoke test on Chrome for Android and Safari iOS for: open drawer → tap input → verify input is above keyboard.

**Files**: `src/components/aiChatDrawer/index.tsx`, `src/App.css`

---

### P2-I · NEW: TTFT not measured against an SLO — no alerting on latency regression

**Gap**: The `AGENT_TTFT` analytics event fires (via `src/utils/hooks/useAgent.ts`), but there is no defined SLO threshold, no alerting when median TTFT exceeds it, and no user-facing communication when responses are slow (beyond the existing skeleton during TTFT).

**Why it matters**: Performance UX — TTFT under 1 second is the target for chat interfaces; latency regressions silently hurt user trust.

**Solution**:
1. Define an internal SLO: `TTFT_SLO_MS = 1500` (1.5s; generous for remote AI).
2. In `useAgent.ts`: after receiving the first chunk, if `ttft > TTFT_SLO_MS`, emit `AGENT_TTFT_SLOW` event to the analytics sink.
3. In `useAgentHealth.ts`: incorporate TTFT percentile into the `degraded` threshold (currently only latency of `/health` endpoint is used).
4. UX: if TTFT exceeds 3 seconds, upgrade the skeleton bubble to show "Still thinking…" helper text alongside the skeleton — reassures users the request is in-flight.

**Files**: `src/utils/hooks/useAgent.ts`, `src/utils/hooks/useAgentHealth.ts`, `src/constants/analytics.ts`

---

### P3-A · NEW: Command palette no-results state has no Copilot fallback CTA

**Gap**: When command palette search returns zero results, it shows "No matches." with no suggested next action. Users who were trying to find something AI-searchable hit a dead end.

**Solution**: When no-results state is reached and the query is ≥ 3 characters long, append: "Try asking Board Copilot →" — a button that closes the palette and opens `AiChatDrawer` with the query pre-filled in the input.

**Files**: `src/components/commandPalette/index.tsx`

---

### P3-B · NEW: Markdown rendering during streaming not confirmed

**Gap**: The inventory shows token-by-token SSE streaming, but it is unconfirmed whether markdown (headers, code blocks, bullet lists) renders progressively during streaming or is held until stream-end and then batch-flipped from raw syntax to formatted output.

**Why it matters**: Raw markdown mid-stream is a jarring experience that undermines trust in the UI's quality.

**Solution**:
1. Verify in `aiChatDrawer/index.tsx` that the message content is passed through the markdown renderer on every state update, not only on stream completion.
2. If markdown is batched: move the renderer call inside the streaming state update so it runs on every chunk.
3. Add a snapshot test that verifies a mid-stream response containing `**bold**` renders `<strong>bold</strong>`, not raw asterisks.

**Files**: `src/components/aiChatDrawer/index.tsx`

---

### P3-C · NEW: Copy response button absent from chat responses

**Gap**: The feedback popover provides thumbs-up/down, but there is no "Copy" button on assistant messages. Users who want to paste AI output into a Jira description, Slack, or doc must manually select and copy text.

**Solution**: Add a `<CopyButton>` to the assistant message action bar (alongside the feedback popover trigger). Use `navigator.clipboard.writeText(plainText)` where `plainText` strips markdown syntax. Show `message.success("Copied")` on success, matching the existing clipboard pattern used in `boardBriefDrawer`.

**Files**: `src/components/aiChatDrawer/index.tsx`

---

### P3-D · NEW: No "Edit prior message" or conversation branching

**Gap**: Users cannot edit a previously submitted message to explore an alternative thread. They must re-type the query from scratch, losing the exploration context.

**Solution (minimal viable)**: Add a pencil/edit icon on user message bubbles. On click: copy the message text back into the input field and prompt the user — "Editing your message will not create a new branch. Your current response will be replaced." On confirm: re-submit. Full branching (maintaining parallel threads) is deferred to Phase 4/5 of the Copilot shell.

**Files**: `src/components/aiChatDrawer/index.tsx`

---

### P3-E · NEW: `aiSearchInput` line-length and response layout on mobile unconfirmed

**Gap**: The `maxLineLengthCh = 75` token exists in `src/theme/tokens.ts` but it is unconfirmed whether it is applied to chat messages and `aiSearchInput` rationale text. On small screens, uncontrolled line length reduces readability.

**Solution**: Confirm that `max-width: ${tokens.maxLineLengthCh}ch` is applied to the prose content container inside both `aiChatDrawer` message bubbles and `aiSearchInput` rationale tooltips. If not, add it.

**Files**: `src/components/aiChatDrawer/index.tsx`, `src/components/aiSearchInput/index.tsx`, `src/theme/tokens.ts`

---

## 3. Summary table — all open items ranked

| Rank | ID | Title | Severity | Category |
|---|---|---|---|---|
| 1 | P1-A | Unified Copilot surface / eliminate entry-point fragmentation | P1 | IA & Discoverability |
| 2 | P1-B | Proposal-undo + agent activity log (prerequisite for write tools) | P1 | Agentic safety & User Control |
| 3 | P1-C | Context-window limit warning + New Conversation button | P1 | Conversation Management |
| 4 | P2-A | Screen-reader interim "AI is responding…" announcement | P2 | Accessibility |
| 5 | P2-B | Focus management after AI response renders | P2 | Accessibility |
| 6 | P2-C | Conversation history persistence across sessions | P2 | Conversation Management |
| 7 | P2-D | Scroll-to-bottom FAB during streaming | P2 | Streaming UX |
| 8 | P2-E | Progressive disclosure / summary-first for long responses | P2 | Response Quality |
| 9 | P2-F | Copilot capabilities / knowledge-cutoff disclosure ("About") | P2 | Transparency |
| 10 | P2-G | Service-degradation banner (promote health dot to inline alert) | P2 | Error Handling |
| 11 | P2-H | Mobile: AI chat input obscured by soft keyboard | P2 | Mobile UX |
| 12 | P2-I | TTFT SLO + "Still thinking…" fallback at 3 s | P2 | Performance UX |
| 13 | P3-A | Command palette no-results → "Ask Board Copilot" CTA | P3 | Discoverability |
| 14 | P3-B | Verify markdown renders progressively during streaming | P3 | Streaming UX |
| 15 | P3-C | Copy button on assistant messages | P3 | Feedback Mechanisms |
| 16 | P3-D | Edit prior message (minimal: re-fill input) | P3 | Conversation Management |
| 17 | P3-E | Confirm `maxLineLengthCh` applied to chat + search rationale | P3 | Typography / Mobile |

---

## 4. Implementation order

### Sprint 1 — P1 items (block write-tool roadmap)
- P1-C: Context window warning + New Conversation button (self-contained, low risk)
- P1-A: Begin Copilot shell scaffolding (`copilotShell/` component, tabs stub, route `AiChatDrawer` into Chat tab)
- P1-B: Proposal-undo surface inside Activity tab (prerequisite for re-enabling `aiMutationProposalsEnabled`)

### Sprint 2 — Accessibility & Streaming (P2-A through P2-D)
- P2-A: Interim screen-reader announcement (< 1 day)
- P2-B: Focus management after response (< 1 day)
- P2-D: Scroll-to-bottom FAB (< 1 day)
- P2-G: Health badge → inline alert in drawer (< 1 day)

### Sprint 3 — Transparency & Mobile (P2-E through P2-I)
- P2-F: `CopilotAboutPopover` (new component)
- P2-C: Phase A of history persistence (localStorage + "sessions not saved" notice)
- P2-H: Mobile keyboard viewport fix
- P2-E: Long-response collapse (or system-prompt improvement)
- P2-I: TTFT SLO event + "Still thinking…" UX

### Sprint 4 — Polish (P3 items)
- P3-A: Command palette no-results CTA
- P3-B: Streaming markdown rendering verification + snapshot test
- P3-C: Copy button on messages
- P3-D: Edit prior message (minimal)
- P3-E: `maxLineLengthCh` audit

---

## 5. Cross-references

- Existing AI UX plan (Phases 1–3 resolved, Phases 4–5 open): `AI_UX_OPTIMIZATION_PLAN.md`
- General UI/UX plan (foundations, responsive, a11y): `docs/ui-ux-optimization-plan.md`
- Board Copilot PRD: `docs/prd/board-copilot-v3.md`
- Production readiness tracker: `docs/PRODUCTION_READINESS.md`
- AI best-practices research basis: `docs/ai-ux-best-practices-research.md`
