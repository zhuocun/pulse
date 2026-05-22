# 04 — AI / Copilot surfaces review

## TL;DR

The Copilot stack is impressively complete on paper — 19 components covering the full agentic loop (chat, brief, draft, estimation, search, palette, nudges, mutation proposals, consent, citations, feedback). Day-to-day, however, the **product reads as five competing AI surfaces**, not one cohesive Copilot. The board header alone exposes a Copilot dropdown plus a duplicate Brief/Ask compact-row plus a settings popover plus a sparkle in search plus a "/" command-palette mode — five doors into AI on a single viewport. The two big drawers (`AiChatDrawer`, `BoardBriefDrawer`) are independent, cannot be open together, and store transcripts/cache in disjoint stores. There are real, fixable regressions: the chat composer disables the textarea while streaming (`AiChatComposer.tsx:41`) which violates §2.1 of the team's own best-practices doc; the mutation card's 10-second countdown is irrevocable after commit even when the proposal is `undoable` and no `onUndo` was passed; `aria-live` regions are scattered as ad-hoc inline-style divs across four surfaces with subtly different shapes; the welcome banner reads as a single brand voice but the chat's no-source caveat reads as a system warning; the citation chip flag affordance does nothing visible after a click; and `aiSparkleIcon`'s default `aria-label="Board Copilot"` makes every decorative use bleed "Board Copilot" into surrounding accessible names whenever an author forgets `aria-hidden`. Below: 27 ranked findings, six ambitious redesigns tied to the existing component graph, and a quick-wins list that can land before any redesign work.

## Surfaces audited

### Read in full

| Path                                                                                | LoC   | Role                                                  |
| ----------------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| `src/components/aiChatDrawer/index.tsx`                                             | 2115  | Conversational shell, citations, proposals, nudges    |
| `src/components/aiChatDrawer/AiChatComposer.tsx`                                    | 93    | Input/send/stop sub-component                         |
| `src/components/aiChatDrawer/aiChatDrawerStyles.ts`                                 | 109   | Bubble, attribution, streaming cursor                 |
| `src/components/aiTaskAssistPanel/index.tsx`                                        | 862   | Inline estimate + readiness card on task modal        |
| `src/components/aiTaskDraftModal/index.tsx`                                         | 899   | "Draft with AI" prompt → form / breakdown             |
| `src/components/boardBriefDrawer/index.tsx`                                         | 952   | "What's happening on this board" summary              |
| `src/components/aiSearchInput/index.tsx`                                            | 686   | NL search + match strength + reformulations           |
| `src/components/commandPalette/index.tsx`                                           | 728   | Cmd-K nav + `/` AI mode                               |
| `src/components/mutationProposalCard/index.tsx`                                     | 409   | Accept/reject diff + 10s undo                         |
| `src/components/nudgeCard/index.tsx`                                                | 165   | Triage recommendation card                            |
| `src/components/citationChip/index.tsx`                                             | 152   | Sup-style `[1]` chip with quote tooltip               |
| `src/components/copilotPrivacyPopover/index.tsx`                                    | 275   | "What is shared?" disclosure (+ inline variant)       |
| `src/components/copilotAboutPopover/index.tsx`                                      | 372   | Capabilities + knowledge cutoff + server limits       |
| `src/components/copilotRemoteConsentNotice/index.tsx`                               | 91    | One-shot consent gate for remote mode                 |
| `src/components/copilotWelcomeBanner/index.tsx`                                     | 128   | First-time AI banner                                  |
| `src/components/engineModeTag/index.tsx`                                            | 38    | Local-vs-remote pill                                  |
| `src/components/aiSparkleIcon/index.tsx`                                            | 138   | Brand sparkle gradient SVG                            |
| `src/components/aiConfidenceIndicator/index.tsx`                                    | 72    | Band+percent tag                                      |
| `src/components/aiMatchStrengthBadge/index.tsx`                                     | 87    | Per-result match strength chip                        |
| `src/components/aiSuggestedBadge/index.tsx`                                         | 85    | "Suggested by Copilot" provenance pill                |
| `src/components/aiFeedbackPopover/feedbackPopover.tsx`                              | 159   | Thumbs-down category form                             |
| `src/components/aiFeedbackPopover/copilotSurfaceFeedback.tsx` (referenced)          | n/a   | Generic feedback bar for non-chat surfaces            |

### Referenced design docs

- `docs/design/ai-ux-best-practices.md` (read in full — already a strong contract)
- `docs/prd/v3-ai-ux.md` (read in full — the authoritative implementation PRD)
- `src/theme/aiTokens.ts`, `src/theme/tokens.ts`

### Touched, not deeply read

- `src/pages/board.tsx` (header AI cluster: lines 631–782)
- `src/pages/project.tsx` (top-level Ask Copilot button: 320–328)

## Findings — ranked

Severity legend: **S1** = trust/correctness regression or a11y blocker, **S2** = visible UX defect affecting most users, **S3** = polish / inconsistency.

### S1 — Trust / correctness / a11y

**F1. Composer textarea disables itself during streaming.** [S1, accessibility & flow]
`src/components/aiChatDrawer/AiChatComposer.tsx:41` — `disabled={isLoading}`.
The team's own best-practices doc (§2.1) is explicit: *"Disable input during streaming: prevent simultaneous submissions; offer a stop control instead."* That sentence is about disabling **submission**, not the textarea itself. The current implementation prevents a user from drafting their next question while the model is still talking — a basic ChatGPT/Claude expectation. The Stop button already exists on the right side. **Fix:** drop `disabled={isLoading}`; instead, leave the textarea writable, swap the send button for Stop while streaming (already done), and gate `dispatch` if `isLoading`.

**F2. Mutation proposal: countdown undo is the only undo, even for "undoable" actions.** [S1, agency]
`src/components/mutationProposalCard/index.tsx:201–258`.
The card's lifecycle is `idle → countdown(10s) → committed`. Once `committed`, `onAccept` has already fired, and the only post-commit Undo button (line 374–382) is rendered when **both** `proposal.undoable && typeof onUndo === "function"`. In `AiChatDrawer`, `onUndo` is never wired (search the file — no `onUndo` prop is passed to `MutationProposalCard` at line 1874). So even when the agent's contract marks an action `undoable: true`, the UI strips the post-commit revert and the user has exactly 10 seconds. Worse, the card never reaches the `committed` UI in production paths because the parent typically clears `pendingProposal` after Accept, so the card unmounts and the Undo button never renders even if it were wired. **Fix:** thread `onUndo` from `AiChatDrawer` through to a parent that can fire the BE reversal, or move the "still undoable" state into the History tab proposed in v3-ai-ux §7.3 (not yet built).

**F3. `aria-live` is a hand-rolled inline-style sr-only div copy/pasted across four surfaces.** [S1, accessibility & maintainability]
- `src/components/aiChatDrawer/index.tsx:1059–1076` (completion announcement)
- `src/components/aiChatDrawer/index.tsx:1078–1094` (streaming announcement)
- `src/components/aiTaskAssistPanel/index.tsx:537–543` (uses `srOnlyLiveRegionStyle` helper)
- `src/components/boardBriefDrawer/index.tsx:684–691` (uses helper)
- `src/components/aiSearchInput/index.tsx:473–502` (hand-rolled inline)
- `src/components/commandPalette/index.tsx:530–553` (hand-rolled inline)

The chat drawer's two regions use inline `clip: "rect(0 0 0 0)"`-style objects, but two other surfaces import the centralised `srOnlyLiveRegionStyle` helper, and the search input and palette repeat the same inline pattern again. This is the kind of inconsistency that produces a "works on three surfaces, missing on the fourth" bug. **Fix:** Promote `srOnlyLiveRegionStyle` to a `<SrOnlyLive role mode="polite|assertive">` component and migrate every site.

**F4. `aiSparkleIcon` default exports `aria-label="Board Copilot"` when not hidden.** [S1, accessibility]
`src/components/aiSparkleIcon/index.tsx:99–106` — if `aria-hidden` is not explicitly passed, the icon renders `role="img" aria-label={title ?? "Board Copilot"}`. PRD v3 S-R3 requires this to be a TypeScript error, not a silent default. The current behaviour means every decorative use (button icons, drawer headers, prefix in search input) that forgets `aria-hidden` causes screen readers to read "Board Copilot" alongside the button's own label — e.g. "Board Copilot, Ask Board Copilot". I verified this is mitigated in most call sites (e.g. `project.tsx:323`, `boardBriefDrawer:671`, `aiChatDrawer:1025`, `commandPalette:520`) — but defending against forgotten `aria-hidden` should be the type system's job, not memory. **Fix:** require either `aria-hidden: true` or an explicit `title`/`aria-label` via discriminated union props, no string default.

**F5. Chat-drawer no-sources caveat is rendered for every assistant turn with empty citations, even when tools answered.** [S1, transparency]
`src/components/aiChatDrawer/index.tsx:1675–1697`. The guard `m.citations?.length === 0 && !assistantHadToolStep(index)` is correct — but `assistantHadToolStep` walks backwards through messages until it hits a `user` role (line 786–794). If a follow-up question doesn't trigger any tool calls (chit-chat, "thanks") the caveat fires every time. Repeated "Board Copilot answered without consulting any source" on a casual turn is alarming and trains users to ignore the caveat that would matter on a factual claim. **Fix:** Only render the caveat when the assistant's text contains a factual assertion heuristic (presence of numerals, named entities, or `[cite:` markers) or when the agent explicitly stamps `requires_source=true`; otherwise suppress.

**F6. Citation flag click "Thanks for your feedback" toast fires inside an open tooltip — the tooltip swallows focus and the toast lives behind it.** [S1, focus & feedback]
`src/components/citationChip/index.tsx:94–105`. `handleFlag` is the only interactive control inside the AntD Tooltip body; clicking it stops propagation but does not close the tooltip, and AntD's tooltip portals z-index sits *under* the global App message portal in this app's stacking context. After click the user sees "Flagged" inside the tooltip while a duplicate toast may obscure it. Worse, the tooltip is hover/focus-triggered, so on touch devices the only way to summon the flag button is a long-press, and the long-press releases as the click fires — flaking the button on iPhone. **Fix:** Move flag into a Popover (click-trigger) below the chip, not a tooltip; let the tooltip stay informational with just the quote.

**F7. `AiChatComposer.tsx:46–51` traps Enter to send even in IME composition.** [S1, accessibility for CJK/Korean/Vietnamese typing]
`onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); onSend(); } }}`. There is no `event.nativeEvent.isComposing` check. Users typing Chinese / Japanese / Korean characters will have their first commit-Enter sent instead of selecting the candidate. AntD's `onPressEnter` does not natively filter compositions. **Fix:** `if (!e.shiftKey && !e.nativeEvent.isComposing) { ... }`.

**F8. CitationChip Popover semantics: `role="note"` when `onNavigate` is absent.** [S1, ARIA misuse]
`src/components/citationChip/index.tsx:142`. `role="note"` is a landmark-style role meant for "a section whose content is parenthetic or ancillary." Putting it on an inline `<span>` chip used as a superscript is mis-use of ARIA. A non-clickable chip should remain a plain `<span>` with no role (the Tooltip already provides the accessible affordance). **Fix:** Omit the `role` attribute entirely when `onNavigate` is not provided; never set `role="note"` on an inline element.

**F9. Mutation card uses `role="alertdialog"` but renders inline in chat, not as a focus-trapped modal.** [S1, ARIA misuse]
`src/components/mutationProposalCard/index.tsx:271`. The card is rendered inline between the last chat message and the input (`aiChatDrawer:1872–1883`), but its outer `Wrap` is tagged `role="alertdialog"`. WAI-ARIA `alertdialog` requires focus management — focus should move into the dialog and be trapped until dismissed. None of that happens here. The card is *aspirationally* a dialog but lives in the document flow. **Fix:** Either (a) move into an AntD Modal when used inline-in-chat (cleaner), or (b) drop the role to `role="region" aria-label={heading}` and add `aria-labelledby` to the heading; keep `role="alertdialog"` only for the "review-each" full-modal flow.

**F10. PrivacyDisclosure dismissal uses `localStorage` with no per-route memory — first dismissal covers all routes.** [S1, privacy]
`src/components/copilotPrivacyPopover/index.tsx:181–190` defaults `storageKey = "boardCopilot:privacyShown"`. The only consumer that overrides this is `AiTaskDraftModal` with key `boardCopilot:draftPrivacyShown` (good). But the inline `CopilotPrivacyDisclosure` exposes one shared "I've seen it" boolean for any route, so a user who acknowledges privacy in chat never sees the disclosure when they later open a board-brief or estimation that sends a *different* payload contract. PRD §9.7 explicitly requires the popover to "accurately describe every category of data sent." **Fix:** Hash the storage key with the route name (`boardCopilot:privacyShown:{route}`), or surface the disclosure as a tooltip-anchored info icon every time and persist only the dismissal of the inline banner.

**F11. Welcome banner CTA opens **brief** drawer, but the banner copy promises "summarize, draft, estimate, answer questions" — i.e. multiple capabilities.** [S2, capability mismatch]
`src/pages/board.tsx:597–602` wires `onCta={() => openBriefDrawer()}`. The banner body promises four things but the CTA only triggers one. A user who clicks "Try it" expecting a chat ends up in the brief drawer and may interpret that as "this is what Copilot does." **Fix:** Either rewrite the CTA to "See your board brief," or open the chat with a pre-loaded "Summarize this board" prompt that exercises the full streaming surface.

**F12. Chat composer character counter shows current/max with no warning when the user pastes >max.** [S2, validation feedback]
`src/components/aiChatDrawer/index.tsx:765–771` computes `promptCharHintText` and `promptCharHintWarning = input.length > promptCharMax * 0.9`. But `AiChatComposer.tsx:44` enforces `maxLength={microcopy.ai.characterCounterMax}` on the TextArea — pasting more than max silently truncates without explanation. The "approaching limit" warning fires at 90% but never says "we will cut you off at N." **Fix:** Render the warning state at 100%+ with copy "Your message will be trimmed to {max} characters when sent."

### S2 — Visible UX defects

**F13. Three AI buttons on the board header next to each other.** [S2, IA / discoverability overload]
`src/pages/board.tsx:631–782`:
- Lines 636–682: new `Dropdown` "CopilotMenu" sparkle button (containing Ask + Brief).
- Lines 684–714: legacy `Space.Compact` with separate Brief + Ask buttons.
- Lines 717–781: Copilot settings Popover (gear).

A code comment at line 683 reads `/* P1-A: Consolidate into CopilotMenu in next phase */` — i.e. the team knows. But it's still in production. Users see four sparkles in one row (CopilotMenu icon + brief icon + ask icon + sparkle inside `AiSearchInput`'s prefix). **Fix:** Remove the legacy `Space.Compact` block now; the Dropdown is sufficient.

**F14. Chat and Brief drawers are mutually exclusive — opening chat closes brief and vice-versa via their independent `open` state.** [S2, multitasking]
The two drawers are mounted as separate `<Drawer>` instances at `board.tsx:948` and `956` and each owns its own `open` boolean. AntD drawers don't visually mask each other but they share the right edge — opening one over the other produces an awkward stack with both visible at 420px. The product mental model in v3-ai-ux §7.1 is a single tabbed right-rail. Today the user must close brief to chat, or chat to skim brief, losing context. **Fix:** Build the unified `CopilotDock` (see Ambition #1) as a tabbed drawer; until then, switch to a single right shelf with internal tabs ("Chat" / "Brief") backed by the same drawer instance.

**F15. The brief drawer auto-fires the agent every time fingerprint changes but doesn't tell the user.** [S2, latency feedback]
`src/components/boardBriefDrawer/index.tsx:480–500`. When `fingerprintChanged` is true, the effect aborts the in-flight agent, clears the suggestion, and starts a fresh remote brief — silently. The user sees the skeleton flash. If they were mid-read of the previous brief, the content disappears under them. **Fix:** Render an inline "Board changed — Refresh to update" banner instead of auto-firing, OR keep auto-fire but cross-fade the new headline into the old one so the read isn't destroyed.

**F16. Engine Mode Tag is repeated in every drawer header.** [S2, visual noise]
- `aiChatDrawer:1032`: `<EngineModeTag />`
- `boardBriefDrawer:678`: `<EngineModeTag />`
- `aiSearchInput:471`: `<EngineModeTag />`
- `aiTaskAssistPanel:530`: `<EngineModeTag />`
- `aiTaskDraftModal:472`: `<EngineModeTag />`

`EngineModeTag` only knows about a global env flag (`environment.aiUseLocalEngine`). It will be the same value in every surface for a given session. Showing the tag in every header trains users to ignore it. **Fix:** Surface it once in the global app chrome (sit it next to the Copilot toggle in `Header`) and let surfaces inherit. Keep it inline only where the engine could theoretically differ (e.g. per-project override, which doesn't yet exist).

**F17. Confidence indicator uses raw English `BAND_LABEL[band].toLowerCase()` for screen-reader `aria-label`.** [S2, i18n]
`src/components/aiConfidenceIndicator/index.tsx:57` — `ariaLabel = "Confidence ${BAND_LABEL[band].toLowerCase()}, ${percent}"`. The visible label flows through `microcopy.ai.confidenceBands` and is locale-aware. The screen-reader label is hard-coded English. **Fix:** Template through `microcopy.a11y.confidenceAriaLabel` (which exists or should be added).

**F18. Sample prompts in chat re-render the *same first two* prompts after every turn, never contextual.** [S2, discoverability]
`src/components/aiChatDrawer/index.tsx:1902–1927` — `microcopy.ai.chatSuggestions.slice(0, 2)`. PRD C-R5 specifies "Cache-driven: 1) What's at risk? 2) {lastTouchedTaskName} — what's the status? 3) Who has the most open work?" The current implementation completely ignores `messages` content. A user 6 turns deep sees the same generic first-time chips. **Fix:** Derive chips from board cache (cached tasks, last opened taskId) per the PRD.

**F19. AntD `Modal.confirm` for "Reset conversation" doesn't preserve focus or speak the confirmation to screen readers in a deterministic way.** [S2, accessibility]
`src/components/aiChatDrawer/index.tsx:985–989` calls `Modal.confirm({ content, onOk: resetAll })`. AntD's imperative confirm injects a portal modal but does **not** restore focus to the originating button on Cancel. After a user dismisses the confirm, focus typically lands on `<body>` and a keyboard-only user has to Tab back to the conversation. **Fix:** Use the declarative `Modal` with `okButtonProps={{ autoFocus: true }}` and explicitly restore focus to `inputRef.current` after close.

**F20. `aiSearchInput` "Did you mean?" reformulator is purely lexical and easily produces tautologies.** [S2, capability framing]
`src/components/aiSearchInput/index.tsx:69–92`. For query `"open login"` the suggestions become `"open"`, `"tasks about open login"`, `"open open login"`. The third is obviously broken. Users will read this as "the AI is dumb." **Fix:** Either delete the local reformulator and surface the remote suggestion only when the agent provides one, or guard against word duplication in the synthesized strings.

**F21. Mutation card's "Apply" button label is `microcopy.actions.apply` ("Apply").** [S2, action language]
`src/components/mutationProposalCard/index.tsx:393`. The heading says "Copilot proposes [description]" but the primary verb is the generic "Apply." Per the best-practices doc §9.4 the verb should mirror the action — "Reassign", "Move", "Update story points." The card *does* have logic to derive a verb (`buildChangingFields` at line 167) but doesn't put it in the button. **Fix:** Set the button label to the primary verb derived from `proposal.kind` (already in the model) with "Apply" as fallback only.

**F22. `aiSparkleIcon`'s gradient fallback hex is the brand orange (`#EA580C` / `#F97316`), but the icon is positioned as a *violet* AI accent in PRD §11.1.** [S2, brand inconsistency]
`src/components/aiSparkleIcon/index.tsx:75–84` falls back to brand-orange when CSS vars aren't loaded. In contrast `aiTokens.ts` and `App.css` aurora variables resolve to purple/lavender at runtime (per the design system's aurora palette). When CSS hasn't loaded (SSR, error states, dialog portals on cold cache) the sparkle briefly renders **orange** then flips to **purple** — a visual flash that contradicts the "violet AI accent" mental model. **Fix:** Drop the orange fallback in the SVG; let the gradient render as a default neutral until CSS resolves, or ship the gradient as part of a global `<style>` injected at app boot.

**F23. CommandPalette mobile renders as bottom-sheet **but** the sparkle toggle button on the input prefix has minHeight/minWidth: 44 px which on mobile becomes a chunky tap target eating ~15% of the input width.** [S2, mobile aesthetic]
`src/components/commandPalette/index.tsx:498–522`. The 44 px touch target is correct for accessibility but inside a phone-width input it looks like a button glued to the input rather than an inline mode indicator. **Fix:** On small viewports, render the toggle as a small icon button above the input (a separate row) rather than inside the prefix; alternatively, drop the toggle on mobile and rely solely on the leading "/" gesture.

**F24. `boardBriefDrawer` "Generated N minutes ago" relative timestamp uses a 30 s interval that updates whether or not the drawer is visible.** [S2, performance / battery]
`src/components/boardBriefDrawer/index.tsx:517–521`. The interval runs only while `open`, which is correct. But it triggers a React state update every 30 s, which re-renders the entire ~330-line tree because `now` is in component state. **Fix:** Move the timestamp into a separate memo'd `<RelativeTime then={generatedAt} />` component that owns its own setInterval, so the parent doesn't re-render.

**F25. `AiTaskAssistPanel` has a hard-coded English "Based on similar tasks on this board." tooltip on the confidence indicator.** [S2, i18n]
`src/components/aiTaskAssistPanel/index.tsx:645`. Adjacent strings flow through `microcopy.*`. **Fix:** Move to `microcopy.ai.estimateConfidenceTooltip`.

### S3 — Polish / consistency

**F26. `aiSuggestedBadge` opens a Popover on `["click", "focus"]` trigger.** [S3, focus thrash]
`src/components/aiSuggestedBadge/index.tsx:71`. AntD Popovers with both triggers will pop both on Tab focus and on Click — the user sees a double-flash if they tab in and click. **Fix:** Drop `"focus"`; provide a tooltip on hover instead for sighted users, and rely on the click trigger for the popover.

**F27. AntD `Tag` is used everywhere AI surfaces want a "pill" — but `AiSuggestedBadge`, `CitationChip`, `EngineModeTag`, `AiConfidenceIndicator`, `AiMatchStrengthBadge`, plus three inline `<Tag>` uses in `MutationProposalCard`, `boardBriefDrawer`, and the chat drawer all hand-tune `Tag` styling with custom radii, fonts, paddings.** [S3, design-system drift]
There is no shared `<CopilotChip>` primitive. Each component reinvents pill geometry (pill radius 999, font xs−1, padding 1px 6px, etc.). **Fix:** Promote a shared `<CopilotChip variant="badge|citation|confidence|engine|strength|suggested">` primitive in `src/components/copilotChip/index.tsx` so the next theme swap is one file.

## Ambitious redesign proposals

### Ambition 1 — Unify `AiChatDrawer` + `BoardBriefDrawer` into a single `CopilotDock` with tabs

**Current.** Two independent right-edge drawers (`aiChatDrawer/index.tsx`, `boardBriefDrawer/index.tsx`). Each owns its own state, can't be open simultaneously, has its own consent notice, privacy popover, engine-mode tag, mutation proposal sink, and welcome banner CTA. Combined LoC: ~3000.

**Direction.** Build `src/components/copilotDock/index.tsx` as a single shell that:
1. Hosts an AntD `Tabs` component with tabs `Chat | Brief | Activity | Settings` (Activity = the v3 §7.3 history; Settings = autonomy + project enablement).
2. Mounts the existing chat composer/transcript and brief content as `<ChatTab />` and `<BriefTab />` subcomponents (refactor — don't duplicate).
3. Persists tab + open state to `localStorage` (per v3-ai-ux §7.1).
4. On desktop: 420 px persistent right shelf (collapsible to an icon rail at `<lg`). On mobile: full-height bottom sheet with the tabs as segmented control at the top.
5. Single consent notice, single privacy popover, single engine tag, single welcome banner — all in the dock header.

**Payoff.**
- Removes F13–F14 entirely. Replaces three header buttons with one sparkle button that toggles the dock.
- Removes the 5x duplication called out in F16.
- Makes Activity / History viable for the first time without standing up another drawer.
- Lets the user keep brief visible while asking chat questions about it — a step-change for "what is happening?" workflows.

**Risk.**
- Big refactor — touches both drawers' test suites (10+ test files). Mitigate by extracting the inner `ChatTabBody` and `BriefTabBody` as pure components first, then mounting them inside the new dock and the old drawers in parallel for a release.
- Mobile bottom-sheet height interaction with iOS keyboard is non-trivial (the chat drawer already uses `env(keyboard-inset-height)` at line 1018, but combining that with tab-switching is new).

**Effort.** L (3–5 d for an experienced dev). Phase it: ChatTabBody extraction → BriefTabBody extraction → new dock shell → flag-gated rollout → delete the old drawers.

### Ambition 2 — Inline ghost-text suggestions in task description (Copilot writes as you type)

**Current.** "Drafting" lives only in `AiTaskDraftModal`. Once the user is inside the regular `TaskCreator` / task modal note field, Copilot disappears.

**Direction.** Add a new shared component `src/components/aiGhostText/index.tsx` that wraps any AntD `Input.TextArea`:

```
<AiGhostText route="task-note" context={taskContext}>
  <Input.TextArea ... />
</AiGhostText>
```

Behind the scenes:
1. Debounce 600 ms on the input.
2. Call a new lightweight `useAgent("note-ghost-agent")` (or the local engine's `note-completion` route).
3. Render the suggested completion as faded text after the caret in an absolutely-positioned overlay sibling.
4. Tab → accept, Esc → dismiss; arrows/typing → re-debounce.

**Payoff.** Closes the "Copilot exists only at the boundaries" gap. Cursor's UX is the canonical reference here; Notion AI has it too.

**Risk.** Privacy — note bodies become part of the AI payload. Mitigate by **only** calling the ghost endpoint when the user has opted in via the existing `CopilotPrivacyDisclosure`. Also requires the agent server to support sub-300 ms inference for ghosting to feel like a feature, not a lag — start with the local-engine path only.

**Effort.** M (2–3 d). Mostly a positioning/IME problem on the FE; the agent route can be a thin wrapper around `chat-agent` with a tight system prompt.

### Ambition 3 — Promote `NudgeCard` into a top-level **Inbox** destination, not a chat-drawer footnote

**Current.** `nudgeCard/index.tsx` is rendered only inside `AiChatDrawer` (line 1884–1899). The triage agent emits nudges but the user has to open chat to see them — they're invisible until the user goes looking.

**Direction.** Make Inbox the third tab in CopilotDock (Ambition 1). Inbox shows:
1. Active nudges (max 5, aggregated per type) from `useTriageAgent`.
2. Unread badge on the dock launcher equal to `nudges.length - dismissed.size`.
3. Each card has primary CTA + Dismiss + "Why is this here?" (opens citation popover for the nudge's source tasks).
4. A "Don't show this kind for 24h" snooze.

If we go further, surface Inbox at the **app shell level**: a sparkle with unread badge in the global Header (next to the user avatar). One click opens the dock pre-selected to Inbox.

**Payoff.** Aligns with Linear's "Triage" UX, which is what the v3-ai-ux PRD explicitly names as the lesson. Today there is no way for Copilot to *initiate* a useful interaction; this is the missing piece.

**Risk.** Notification fatigue. Mitigate by hard-capping at 5 active nudges per board, decaying after 4 hours (already in PRD §7.2), and respecting `boardCopilot:enabled` toggles.

**Effort.** M (2–3 d) once CopilotDock is in.

### Ambition 4 — Inline "AI ledger" replacing per-surface undo toasts

**Current.**
- `useUndoToast` is used in `AiTaskAssistPanel` (estimate apply, readiness apply) and `AiTaskDraftModal` (bulk subtask create).
- `MutationProposalCard` has its own internal 10 s countdown undo.
- Brief drawer has no undo because briefs don't mutate.
- There is no persistent history across the session — refresh the page and the proposal you accepted 30 seconds ago is gone.

**Direction.** A new `src/components/aiActivityLog/index.tsx` that hosts:
1. An in-memory ledger of every AI-applied mutation in the session (key, applied-at, undo handler, source surface).
2. A persistent inline pill at the bottom-right of the dock: "3 AI changes this session • Show" → expands into a scrollable list with one-click Revert per row.
3. Toasts continue to fire for ~5 s for in-context feedback, but the ledger is the source of truth.

Wire `AiTaskAssistPanel`, `AiTaskDraftModal`, `MutationProposalCard`, and any future agent mutation through a shared `useAiLedger().record({ description, surface, undo })`.

**Payoff.**
- F2 (the "undoable but no undo wired" footgun) becomes structurally impossible.
- Aligns with PRD v3 §7.3 (History tab) and v3 P4 "Mutations need a safety net."
- Builds trust: users can see exactly what Copilot has done to their board.

**Risk.** Cross-session persistence is a real backend dependency (you can't undo a mutation after the session if the server doesn't journal it). v2.1 §6.2 already specifies a journal endpoint; this front-end can ship in "session-only" mode and graduate to persistent once the BE lands. Don't promise persistence in copy until BE is ready.

**Effort.** M (3 d). The hook and the new component are simple; the cross-surface wiring is mechanical.

### Ambition 5 — "Smart ready-to-ship" indicator on board columns using the readiness agent

**Current.** `AiTaskAssistPanel`'s readiness check fires inside a single task modal. The agent already understands when a task is "ready" — assignee set, description present, story points reasonable, no blockers.

**Direction.** Run the readiness agent in batch over a column's tasks (cheap, can be local-engine deterministic). When ≥80% of a column's tasks pass readiness, render a small "Ready to ship" pill on the column header (e.g. "Done" or "Ready for QA"). When <60% pass, render "Needs grooming."

Visually: small sparkle + label in the column header. Click opens a popover listing which tasks still need work. **Reuse `CopilotChip` (Ambition 6 below) for the pill.**

**Payoff.** Surfaces AI value passively, without forcing the user to open a drawer. Pairs with the "Ship-readiness sparkline" mood in modern PM tools (Linear, Height).

**Risk.** Performance — readiness must be deterministic + local for column-batch, otherwise N calls per column. Already supported via `useAi<IReadinessReport>` local engine. Cap the batch at column-open time, not on every task edit.

**Effort.** M (3 d). New small component + wiring into the Column header (`src/components/column/`).

### Ambition 6 — Replace ad-hoc Tag styling with a shared `<CopilotChip>` and ship a single Copilot palette token

**Current.** As noted in F27, every AI surface re-implements pill geometry. The token system in `aiTokens.ts` defines the colors but not the *shape* primitives. The result is six pills with subtly different paddings and font weights, plus a chat-drawer "more sources" link that hand-rolls a chip-shaped button at line 1637–1669.

**Direction.** Introduce `src/components/copilotChip/index.tsx`:

```ts
type Variant = "badge" | "citation" | "confidence" | "engine" | "match" | "suggested" | "risk";
<CopilotChip variant="citation" tone="purple" interactive>...</CopilotChip>
```

Migrate:
- `aiSuggestedBadge` (BadgeTag styled component → CopilotChip variant="suggested")
- `citationChip` (Chip styled → variant="citation")
- `aiConfidenceIndicator` (raw Tag → variant="confidence")
- `engineModeTag` (raw Tag → variant="engine")
- `aiMatchStrengthBadge` (raw Tag → variant="match")
- `MutationProposalCard` risk tag (raw Tag → variant="risk")

Centralize the gradient ring, the soft purple background, and the typography in one component.

**Payoff.** Visual consistency across the 19 components. One file to swap for a brand refresh. Easier to ship dark-mode and reduced-motion variants of the chip's pulse/glow.

**Risk.** Pure refactor — touches a lot of tests. Mitigate by introducing the new component in parallel and migrating surface-by-surface behind feature flag; delete the bespoke variants in the same PR that migrates the last consumer.

**Effort.** S–M (2 d) once the API is settled.

## Quick wins

These are surgical fixes that can land in a single PR each, in order of value/effort ratio.

| # | Fix                                                                                          | File:line                                             | Effort |
| - | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| 1 | Drop `disabled={isLoading}` from the chat textarea so users can type follow-ups while streaming | `aiChatDrawer/AiChatComposer.tsx:41`                  | XS     |
| 2 | Add `!e.nativeEvent.isComposing` to Enter handler                                            | `aiChatDrawer/AiChatComposer.tsx:46`                  | XS     |
| 3 | Remove the legacy `Space.Compact` Brief/Ask row from the board header                        | `pages/board.tsx:684–714`                             | XS     |
| 4 | Remove `aria-label="Board Copilot"` default in sparkle and require a discriminated union     | `aiSparkleIcon/index.tsx:99–101`                      | S      |
| 5 | Promote `srOnlyLiveRegionStyle` to a `<SrOnlyLive>` component and migrate 6 sites            | new `utils/a11y/SrOnlyLive.tsx`                       | S      |
| 6 | Fix mutation card's `role="alertdialog"` to `role="region"` when rendered inline             | `mutationProposalCard/index.tsx:271`                  | XS     |
| 7 | Render citation flag as a Popover with click trigger instead of inside a hover Tooltip       | `citationChip/index.tsx:107–148`                      | S      |
| 8 | Hash the privacy disclosure storage key with route name to fix F10                           | `copilotPrivacyPopover/index.tsx:181`                 | XS     |
| 9 | Change the welcome banner CTA to open chat with a "Summarize this board" prompt              | `pages/board.tsx:599–602`                             | XS     |
| 10 | Replace mutation card "Apply" with the action verb from `proposal.kind`                     | `mutationProposalCard/index.tsx:393`                  | XS     |
| 11 | Drop the orange fallback hex in `aiSparkleIcon`'s gradient stops                            | `aiSparkleIcon/index.tsx:75, 79, 83, 112, 116, 120`  | XS     |
| 12 | Drop `"focus"` trigger from `AiSuggestedBadge` Popover                                       | `aiSuggestedBadge/index.tsx:71`                       | XS     |
| 13 | Use `microcopy.a11y.confidenceAriaLabel` template instead of hard-coded English               | `aiConfidenceIndicator/index.tsx:57`                  | XS     |
| 14 | Move "Based on similar tasks…" tooltip into `microcopy.ai.estimateConfidenceTooltip`         | `aiTaskAssistPanel/index.tsx:645`                     | XS     |
| 15 | Make the chat-drawer no-source caveat fire only on factual-claim heuristic                   | `aiChatDrawer/index.tsx:1675–1697`                    | S      |
| 16 | Render "Board changed — Refresh to update" banner instead of auto-firing brief on fingerprint flip | `boardBriefDrawer/index.tsx:480–500`             | S      |
| 17 | Generate contextual chat follow-up chips from `messages[lastUserIndex]`                      | `aiChatDrawer/index.tsx:1902–1927`                    | M      |
| 18 | Guard the search reformulator against duplicate-word output                                  | `aiSearchInput/index.tsx:69–92`                       | XS     |
| 19 | Move the chat drawer's relative-time renderer into a memoized child                          | `boardBriefDrawer/index.tsx:517–521`                  | XS     |
| 20 | Add character-limit warning copy ("Will be trimmed to {max}") at 100%+                       | `aiChatDrawer/index.tsx:765–771`                      | XS     |

Final note on the brand and aesthetic: the gradient sparkle, the aurora-blob radial gradient on chat drawer body (`aiChatDrawer:1014`), and the violet badge tint do cohere into a recognizable "AI accent" once you see it across surfaces. The orange fallback hexes are the one visible inconsistency; once those are gone (Quick Win 11) the visual language reads as a single Copilot. The shape inconsistency in chips (F27/Ambition 6) is the *next* polish layer beneath color. With Ambition 1 (CopilotDock) the whole surface is on track to feel like *one* product rather than five.
