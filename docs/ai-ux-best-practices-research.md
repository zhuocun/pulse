# AI Web App UX Best Practices — Research Reference

**Created:** 2026-05-05  
**Scope:** Foundational research synthesis for AI-powered web applications, contextualized to the Board Copilot feature in `jira-react-app`. Complements `AI_UX_OPTIMIZATION_PLAN.md` (implementation audit) and `docs/ui-ux-optimization-plan.md` (general UX plan).  
**Primary sources:** Google PAIR Guidebook, Microsoft HAX Toolkit, Nielsen Norman Group AI UX research, NIST AI RMF, Anthropic model card & safety guidance, IBM Design for AI, OpenAI product design guidance, W3C accessibility, Apple ML/privacy design.

---

## 1. Core Principles

These five axioms underlie every section below. Any AI feature that violates one of them should be treated as a defect, not a trade-off.

### 1.1 Calibrated transparency

Users should understand what the AI can do, cannot do, and is currently doing — without being overwhelmed by implementation detail. Transparency is not the same as verbosity. Concise, accurate capability framing (e.g., "finds related tasks using keywords and task metadata") is more trustworthy than broad marketing language (e.g., "understands your project").

**Source:** Google PAIR, NN/g "Mental Models for AI" (2023).

### 1.2 User agency at every step

The AI is a tool, not an authority. Every AI output — a draft, a suggestion, an estimate, a recommendation — must be editable, rejectable, or ignorable. Write tools (mutations) require explicit human approval. Read tools may act silently only if the user has set an autonomy level that authorizes it and can review the action afterward.

**Source:** Microsoft HAX T5 "Support efficient dismissal and correction," Anthropic model card §Human Oversight.

### 1.3 Reversibility of AI-applied changes

Any field, value, or record modified by an AI action must be restorable to its prior state. Showing an "Undo" control without actually reverting the change is worse than not showing Undo at all — it destroys trust when the user discovers the deception.

**Source:** Nielsen Heuristic #3 (User control and freedom), NIST AI RMF GOVERN 1.2.

### 1.4 Honest capability framing

AI features must describe what they actually do. A feature backed by deterministic keyword matching should not be labeled "Ask a question." A heuristic recommendation should not be presented with the confidence of a statistical model. Capability mismatch between label and behavior is one of the top causes of AI distrust (NN/g 2024 AI Trust Study).

### 1.5 Privacy by default

Users must be told — before they act — what data is sent where, and in what mode (local computation vs. remote server). Data minimization (sending only what the AI needs) should be enforced in code, not just policy. Privacy copy must match actual payload content exactly.

**Source:** Apple ML Privacy Design, GDPR Art. 13, NIST AI RMF MAP 5.2.

---

## 2. Interaction Patterns

### 2.1 Prompt input design

- **Character limits with visible feedback**: show remaining characters as the user approaches the limit, not only after they exceed it.
- **Placeholder text as instruction**: use placeholder copy to set capability expectations ("Describe tasks to filter — uses keyword and type matching") rather than generic prompts ("Type here…").
- **Submit on Enter, newline on Shift+Enter**: the de facto standard for chat inputs. Deviating requires a visible hint.
- **Disable input during streaming**: prevent simultaneous submissions; offer a stop control instead.
- **Auto-resize textarea**: single-line for short commands, multi-line for longer prompts, with a maximum height before scroll.

### 2.2 Streaming responses

- Begin streaming as soon as the first token arrives; do not buffer the full response.
- Show a blinking cursor or trailing ellipsis at the generation boundary so users know output is still arriving.
- Render Markdown progressively — avoid layout jumps when a heading, list, or code block completes.
- Debounce DOM updates during fast streaming (requestAnimationFrame) to prevent jank on low-end devices.
- Provide a **Stop** control that halts generation and commits the partial response; do not discard it.

### 2.3 Follow-up and continuation

- Offer **follow-up prompt chips** after each assistant turn. Chips reduce the blank-input problem and guide users toward high-value follow-ups.
- Chips should be contextual (derived from the answer) rather than static (always the same three suggestions).
- After a failed or low-confidence answer, offer repair suggestions: "Try rephrasing," "Be more specific about the column," "See matching tasks instead."

### 2.4 Conversational vs. structured AI output

Not all AI output belongs in a chat bubble. Use the right container for the output type:

| Output type | Preferred container |
|---|---|
| Open-ended Q&A, explanations | Chat bubble with Markdown |
| Structured data (task drafts, estimates) | Form or card with editable fields |
| Board-level insights | Drawer/panel with source chips |
| Inline suggestions (field values) | Ghost text or suggestion badge below field |
| Search filter results | Filtered list with match rationale |

Mixing these reduces scannability and erodes confidence in each output type.

---

## 3. Trust and Transparency

### 3.1 AI attribution

Every AI-generated piece of content must carry a visible origin label:
- A distinct visual treatment (icon + label, e.g., "Board Copilot" with a sparkle icon).
- The label must be legible at a glance — not hidden in a tooltip or collapsed by default.
- Attribution must persist after the user edits an AI-generated field. Use an "AI-suggested" badge that clears on first deliberate edit.

**Source:** Google PAIR "Explain your system to users", NN/g "Disclosure in AI-Generated Content" (2024).

### 3.2 Confidence and uncertainty indicators

- Use a **three-tier confidence system**: high / moderate / low — or equivalent plain-language labels ("Strong signal / Review recommended / Low confidence — verify manually").
- Do not show raw percentages without a plain-language band — percentages invite false precision.
- Match CTAs to confidence:
  - High → primary "Apply" button.
  - Moderate → primary "Apply" + secondary "Review sources."
  - Low → secondary "Apply anyway" + explanation of why confidence is low.
- Never omit a confidence indicator for structured recommendations (estimates, drafts, readiness assessments). Omission implies high confidence.

### 3.3 Citations and source provenance

- Every factual AI claim that draws on board data should cite its source (task name, column, member).
- Citations should be **adjacent to the claim**, not only at the end of a response.
- For local/heuristic engines: emit structured citations from the engine (not reconstructed from text in the UI).
- When sources are absent: show an explicit "No source data" caveat, not silence.
- Citation chips should be **actionable**: clicking opens the referenced task, column, or member.

### 3.4 Local vs. remote AI disclosure

The processing location is material to user consent. Disclose it clearly:

- **Local mode**: "Runs locally in your browser using project rules. No data leaves your device."
- **Remote mode**: "Processed by [service name] at [origin]. Data sent: [categories]. Retention: [policy link or 'configured by workspace admin']."

The disclosure must appear before the first AI request in each mode change, not only in a settings page.

---

## 4. Loading and Latency States

AI inference is slow relative to standard API calls. Every AI surface must treat latency as a first-class UX concern.

### 4.1 Response time thresholds

| Latency | Recommended treatment |
|---|---|
| < 300ms | No indicator needed |
| 300ms – 1s | Spinner or inline "thinking…" |
| 1s – 3s | Skeleton UI (placeholder content shape) |
| > 3s | Skeleton + contextual message ("Reviewing 42 tasks…") |
| > 10s | Skeleton + progress context + explicit cancel option |

### 4.2 Skeleton design

- Skeleton shapes must match the eventual content layout (number of lines, approximate width).
- Animate skeletons with a shimmer that respects `prefers-reduced-motion` — use opacity fade instead of shimmer for reduced-motion users.
- Do not show spinners and skeletons simultaneously; choose one per surface.

### 4.3 Delayed spinners

For surfaces where the AI response often arrives in < 500ms (e.g., short estimates), delay the spinner by 300–400ms to avoid flicker. A spinner that appears and disappears in under 200ms is worse than no indicator.

---

## 5. Error Handling and Failure States

### 5.1 Error taxonomy

Define distinct error types with distinct UX treatment:

| Error type | Cause | User action |
|---|---|---|
| `network` | Connection lost | Retry with exponential backoff |
| `timeout` | Inference exceeded limit | Retry; offer to simplify prompt |
| `rateLimit` (429) | Quota exceeded | Show countdown; disable retry until reset |
| `budget` (402) | Billing limit reached | Show upgrade prompt; no retry |
| `forbidden` (403) | Auth/permission failure | Do not retry; prompt to re-authenticate |
| `server` (5xx) | Backend error | Retry; log error with request ID |
| `validation` | AI returned invalid structure | Silent retry once; fallback to empty state |
| `noResults` | AI found no matching data | Suggest alternatives; do not report as error |

### 5.2 Error copy guidelines

- **Avoid first-person AI voice** in errors ("I couldn't find…"). Use tool-like neutral copy: "Board Copilot could not find an answer."
- Error messages must state: what failed, why (if known), and what the user can do next.
- Include a request/trace ID in expandable details for debuggable errors so support can investigate.
- Distinguish transient errors (retry) from permanent errors (action required); surface them differently.

### 5.3 Graceful degradation

When the AI feature is unavailable, the underlying non-AI workflow must still function:
- AI search failing → standard text search continues to work.
- AI draft unavailable → manual task creation is unblocked.
- AI estimate fails → user can enter story points manually.

Do not gate the core feature on AI availability.

---

## 6. Feedback and Correction Loops

### 6.1 Binary feedback is insufficient

Thumbs up / thumbs down captures sentiment, not actionable signal. Replace or supplement with:

**Negative feedback categories:**
- Incorrect / wrong answer
- Missing source or evidence
- Outdated data
- Not actionable
- Too vague
- Unsafe or risky suggestion
- Privacy concern
- Other (free text, optional)

**Positive follow-up (for repeated positive use):**
- "What worked?" (optional, triggered after 3+ positive signals)

### 6.2 Feedback transparency

Tell users what their feedback changes:
- "Feedback is saved for product review. It does not train the AI model in real time."
- Or, if personalization exists: "This will improve future suggestions for your workspace."

Silence on feedback impact implies the feedback does nothing, which trains users to stop giving it.

### 6.3 Analytics design

Collect signals that improve AI quality without leaking user content:
- Interaction events: stop, retry, regenerate, apply, apply-anyway, undo, reject, feedback category.
- Quality signals: confidence band at apply-time, citation presence, latency to first token (TTFT).
- **Never log**: raw prompt text, raw AI output, task names, task notes, or any user-authored content.

---

## 7. Onboarding and Discoverability

### 7.1 The blank-state problem

An empty AI input with no context produces anxiety, not curiosity. Solutions:

1. **Example prompts** in empty state — 3–5 short, specific, high-value examples.
2. **Contextual defaults** — pre-fill suggestions based on what the user is currently viewing (e.g., the open board's name in the prompt).
3. **Follow-up chips** — after each interaction, surface 2–3 likely next steps.
4. **Progressive disclosure** — introduce features one at a time; do not display all AI affordances on first visit.

### 7.2 Feature introduction

- Introduce AI features through **contextual tooltips** triggered by proximity to the feature, not unsolicited modals on login.
- Use a **copilot welcome banner** for first-time activation that explains 3 things: what the feature does, what data it uses, how to turn it off.
- Provide a **command palette** shortcut (`/` or `Ctrl+K`) for power users who prefer keyboard-driven discovery.

### 7.3 AI mental model consistency

Maintain one consistent mental model per AI interaction type:
- "Ask" → opens chat (conversational, no direct mutation).
- "Find" → filters the current list (search, no chat).
- "Draft" → creates a pre-filled form for review (structured, requires confirmation).
- "Analyze" / "Brief" → generates a summary panel (read-only insight).

The same verb must never trigger different interaction models in different parts of the app.

---

## 8. Accessibility

### 8.1 Live regions for streamed content

Streaming AI output arrives in a DOM node that changes continuously. Screen readers must be notified:
- Use `aria-live="polite"` on the AI response container.
- Use `aria-live="assertive"` only for errors or critical state changes (e.g., stop-generation confirmation).
- Throttle live-region updates during fast streaming (announce every ~500ms or at natural phrase boundaries) to avoid overwhelming screen readers.

### 8.2 Keyboard navigation

Every AI affordance must be reachable and operable without a mouse:
- Open/close AI drawer: keyboard shortcut (documented in UI).
- Stop generation: focusable Stop button with `Escape` as fallback.
- Submit prompt: `Enter`.
- Navigate follow-up chips: `Tab` / arrow keys.
- Feedback controls: `Tab` to reach, `Space`/`Enter` to activate.
- Citation chips: `Tab`-reachable, `Enter` to open linked resource.

### 8.3 Motion and animation

- All AI streaming animations (blinking cursor, shimmer, spinner) must respect `prefers-reduced-motion`.
- Use opacity fade instead of translate/scale animations for reduced-motion users.
- Do not use motion to convey the only indicator of AI state — always pair motion with text.

### 8.4 Icon-only AI controls

Any AI control that uses only an icon (sparkle, send, stop) must have:
- A visible label or tooltip.
- An `aria-label` for screen readers.
- Sufficient touch target size (minimum 44×44px per WCAG 2.5.8).

---

## 9. Privacy, Ethics, and Safety UX

### 9.1 Data minimization in payloads

Build a payload contract per AI route. Each route declares:
- **Included fields**: e.g., task name, type, column, story points.
- **Conditionally included**: e.g., task notes (only if user has opted in).
- **Never included**: e.g., comments, attachments, email addresses.

Enforce minimization in a shared payload builder function, not per-component. This makes privacy disclosures auditable and testable.

### 9.2 Consent for sensitive data

If an AI route can include notes, comments, or user-authored free text:
1. Disclose it in the privacy popover for that specific route.
2. Offer an opt-out (e.g., "Exclude my notes from AI analysis").
3. For remote mode: require first-use consent before the first request that includes sensitive fields.

### 9.3 Content safety and refusal states

Design a deliberate UI for when the AI refuses or cannot help:
- Do not show a raw model refusal message ("I can't help with that").
- Show a product-voice refusal: "Board Copilot can't help with this request. Try asking about tasks, columns, or team workload."
- For sensitive content (e.g., PII detected in a prompt): "This prompt may include personal information. Board Copilot did not process it. [What to do instead]."

### 9.4 Agentic write actions

When an AI can modify data (not just read it):
1. Require explicit autonomy setting before enabling: Suggest only / Propose with confirmation / Apply automatically.
2. Show a **proposal card** before any mutation: what changes, to which records, why, what the risk is, and what happens on undo.
3. Maintain an **activity log** of every AI-applied change, accessible in the session.
4. Every accepted proposal must be undoable via the activity log.
5. Write tools must be red-team tested for prompt injection and scope escalation.

**Source:** Anthropic agent safety, Microsoft HAX H4 "Show contextual information," NIST AI RMF MANAGE 3.2.

---

## 10. Information Architecture

### 10.1 Unified AI entry point

Avoid scattering AI affordances across headers, filter panels, modals, drawers, and command palettes without a coherent mental model. Use a **single primary AI entry** (e.g., a "Copilot" button) that anchors the user's understanding of where AI lives.

Context-specific inline AI (e.g., estimate inside a task modal, draft from a task creator) is appropriate and reduces workflow friction. The distinction is: primary discovery vs. contextual augmentation.

### 10.2 Right-rail Copilot shell

For AI-heavy applications, a persistent right-rail panel with tabs outperforms separate drawers per feature:

| Tab | Purpose |
|---|---|
| Chat | Conversational Q&A with sources |
| Brief | Board summary and recommendations |
| Activity | AI-applied changes, accepted proposals, undoable actions |
| Settings | Data scope, mode, project enablement, privacy |

This structure gives users a single destination to review, question, and control all AI activity.

### 10.3 Session and history management

- Persist chat history within a session; give users the option to clear.
- Do not auto-clear history on page navigation — this destroys context.
- Brief and insight panels should cache results and show a "Generated at [time]" label, with an explicit Refresh action.
- Do not auto-regenerate insights on every page load — it's expensive and surprising.

---

## 11. Visual Design for AI Surfaces

### 11.1 AI vs. human content differentiation

Visually distinguish AI-generated content from user-authored content at a glance:
- Use a consistent AI attribution color (e.g., a purple or blue accent not used elsewhere).
- AI attribution icon (sparkle, robot, wand) must appear consistently — do not vary per surface.
- AI content backgrounds: a subtle tint is sufficient; avoid heavy borders that add visual noise.
- User content and AI content in the same view (e.g., chat) should have distinct bubble shapes or alignment (user right, AI left).

### 11.2 Typography for AI output

- Use the same typeface as the rest of the product — do not switch fonts for AI output.
- Render Markdown headings, lists, and code blocks consistently with the design system.
- Monospace font for code blocks; readable line-height (1.5–1.6) for prose answers.
- Limit line length in prose AI output (60–75ch) for readability.

### 11.3 Dark mode

- AI shimmer animations must have dark-mode variants (light shimmer on dark backgrounds).
- Confidence indicator colors (green/yellow/red) need sufficient contrast in both modes.
- AI attribution tint should be derived from the design system's semantic color tokens, not hardcoded hex values.

### 11.4 Density and visual weight

AI UI tends toward information density. Apply visual hierarchy deliberately:
- The AI answer is primary; citations, confidence, and actions are secondary.
- Use size, weight, and spacing — not color alone — to establish hierarchy.
- Collapsed state (e.g., tool details, expandable evidence) should be clearly interactive, not static.

---

## 12. Measurement and Observability

### 12.1 Trust-calibration metrics

Track signals that indicate whether users trust AI outputs appropriately (neither blindly nor punitively):

| Signal | What it measures |
|---|---|
| Apply rate by confidence band | Whether users act on high-confidence outputs more than low |
| Apply-anyway rate | Whether users override low-confidence warnings |
| Undo rate after apply | Whether AI-applied changes are regretted |
| Stop rate | Whether AI generation is running too long |
| Regenerate rate | Whether first responses are unsatisfactory |
| Feedback negative categories | Which failure modes are most common |
| Citation click rate | Whether users are verifying AI claims |

### 12.2 Privacy-safe event design

Analytics events must never include:
- Raw prompt text
- Raw AI-generated output
- Task names, notes, or descriptions
- User names or email addresses

Events may include: event type, surface name, confidence band (enum), duration (ms), latency (ms), result count (int), feedback category (enum), engine mode (local/remote).

### 12.3 Observability for agentic features

For agent-based surfaces, log:
- `AGENT_TURN_STARTED` (agentName, timestampMs)
- `AGENT_TURN_COMPLETED` (durationMs, tokensIn, tokensOut, toolsCalled)
- `AGENT_HEALTH_DEGRADED` (once per transition, not per request)
- `AGENT_TTFT` (time to first token)
- `PROPOSAL_SHOWN` / `PROPOSAL_ACCEPTED` / `PROPOSAL_REJECTED`
- `PROPOSAL_UNDONE`
- `CITATION_CLICKED` / `CITATION_FLAGGED`

Never log tool output content or the data payloads sent to the AI.

---

## 13. Board Copilot — Principle-to-Implementation Mapping

This table maps the principles above to the current implementation state and the `AI_UX_OPTIMIZATION_PLAN.md` items for traceability.

| Principle area | Implementation state | See also |
|---|---|---|
| AI attribution | Strong — sparkle icon + "Board Copilot" label present | `AI_UX_OPTIMIZATION_PLAN.md` §3.1 |
| Streaming UI | Present in chat | §2.2 above |
| Confidence indicators | Partial — draft and estimate only | P2-1 in optimization plan |
| Citations | Partial — chat only, not claim-level | P0-3 in optimization plan |
| Local vs. remote disclosure | Shipped (Phase 1) | §3.4 above; P0-2 resolved |
| Privacy payload accuracy | Phase 1 partial fix landed | P0-1 in optimization plan |
| Feedback depth | Shallow — thumbs only | P1-3 in optimization plan |
| Undo correctness | Readiness Undo fixed (Phase 1); bulk undo partial | P1-4, P1-5 in optimization plan |
| Capability framing | AI search renamed (Phase 1) | P1-2 resolved; §7.3 above |
| Error copy neutrality | Fixed (Phase 1) | P2-3 resolved; §5.2 above |
| Agentic write safety | MutationProposalCard gated off by default | P1-7, §9.4 above |
| Accessibility | jest-axe suite added (2026-05-04) | §8 above; test plan in opt plan |
| Observability | Sinks + call sites wired (Phase 3) | §12 above; P2-5 resolved |
| Entry point consolidation | Fragmented — Phase 4 target | P1-6, §10.1 above |
| Right-rail Copilot shell | Planned (Phase 4) | §10.2 above |

---

## 14. Key Sources

| Source | Key contribution |
|---|---|
| [Google PAIR Guidebook](https://pair.withgoogle.com/guidebook/) | Transparency, mental models, capability framing, feedback |
| [Microsoft HAX Toolkit](https://www.microsoft.com/en-us/haxtoolkit/) | 18 design guidelines; dismissal, correction, efficient handoff |
| [Nielsen Norman Group — AI UX](https://www.nngroup.com/topic/ai/) | Trust calibration, mental models, disclosure patterns |
| [NIST AI RMF](https://www.nist.gov/system/files/documents/2023/01/26/AI%20RMF%201.0.pdf) | Govern/Map/Measure/Manage risk framework |
| [IBM Design for AI](https://www.ibm.com/design/ai/) | Explainability, confidence, human-AI teaming |
| [Anthropic Model Card & Safety](https://www.anthropic.com/model-card) | Agent safety, human oversight, scope limitations |
| [OpenAI Product UX Principles](https://openai.com/product) | Capability framing, streaming, error handling |
| [Apple ML + Privacy Design](https://developer.apple.com/machine-learning/privacy/) | On-device vs. server disclosure, data minimization |
| [W3C ARIA for Live Regions](https://www.w3.org/TR/wai-aria/#aria-live) | Accessible streaming content patterns |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Target size, focus appearance, motion, authentication |
