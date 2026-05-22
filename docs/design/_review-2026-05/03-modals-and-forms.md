# 03 — Modals + forms review

## TL;DR

The modal/form surfaces are technically solid: `inputMode`/`enterKeyHint`/`autoComplete` are consistent, iOS auto-zoom is correctly prevented by the `pointer: coarse` 16 px rule, popovers cap height in `dvh`, and `Modal.confirm` correctly replaces `window.confirm`. But the surfaces are bottlenecked by **one structural choice**: every detail/edit view is a centered AntD `Modal`, even on phones, even when the task it edits has 6 fields and a 600-LOC composition. Mobile UX, save-discard semantics, history/back-button handling, and "draft a task fast" all suffer for it.

Top correctness/UX issues I'd ship fixes for this week:

1. **TaskModal silently discards in-flight edits if a list re-fetch deletes the task** (`taskModal/index.tsx:248-259`).
2. **AuthErrorSummary steals focus on EVERY field-error update**, jumping the page on a slow blur (`authErrorSummary/index.tsx:80-84`).
3. **No body-scroll lock issue per se** (AntD handles it), but Android back / iOS swipe-back **does not close any modal** — the URL-state hooks were intentionally reverted to Redux in PR #226 with the trade-off accepted but never re-paid (`_createOverlayHook.ts:14-24`).
4. **TaskCreator submits a fully-canned bug template** (`type: "Task", epic: "New Feature", storyPoints: 1, note: "No note yet"`) instead of letting the user pick, so half the modal openings later are *retroactive* edits to undo defaults (`taskCreator/index.tsx:113-122`).
5. **Auth pages and the AntD page-level `Modal.confirm` ignore safe-area-inset-bottom** — destructive Delete on iPhone phones ends up under the home indicator if the keyboard is open.

The ambitious bet: replace `TaskModal` with an inline-expand / routed side panel (`/projects/:id/task/:taskId`), and the TaskCreator template with a one-line composer that opens that panel after create. That single change kills 4 of the 12 findings below and unlocks: deep-linkable tasks, browser-back-to-close, swipe-to-next, no body-scroll lock, no portal mount cost on every board paint, no "destroy on hidden vs forceRender" debate.

## Surfaces audited

| Surface | File | LOC | Type today | Note |
|---|---|---|---|---|
| Task detail / edit | `src/components/taskModal/index.tsx` | 630 | Centered AntD Modal | Has AI side-panel, Delete in footer |
| Project create / edit | `src/components/projectModal/index.tsx` | 237 | Centered AntD Modal | 3 fields, manager dropdown |
| Inline task creator | `src/components/taskCreator/index.tsx` | 196 | Inline collapse → AntD Input | Posts canned template fields |
| Inline column creator | `src/components/columnCreator/index.tsx` | 155 | Inline collapse → AntD Input | Esc/blur-empty collapses |
| Login form | `src/components/loginForm/index.tsx` | 210 | AntD `Form` in auth layout | Has caps-lock slot |
| Register form | `src/components/registerForm/index.tsx` | 206 | Same + password strength | Reused AuthErrorSummary |
| Auth error summary | `src/components/authErrorSummary/index.tsx` | 175 | Stacked `role="alert"` with anchor links | Auto-focuses on update |
| Member popover | `src/components/memberPopover/index.tsx` | 168 | AntD Popover (list, no actions) | Read-only |
| Project popover | `src/components/projectPopover/index.tsx` | 153 | AntD Popover + "Create project" | |
| (Reference) AI task draft modal | `src/components/aiTaskDraftModal/index.tsx` | 899 | AntD Modal, footer `null`, inline buttons | Confirms the same `<Modal>` pattern repeats |

## Findings — ranked

### 1. TaskModal silently closes itself if the editing task disappears from `tasks` — discarding unsaved edits
- **Surface:** taskModal
- **Severity:** High (data loss)
- **Type:** Correctness
- **Evidence:** `src/components/taskModal/index.tsx:248-259`

```
useEffect(() => {
    if (!editingTaskId || isOptimisticPlaceholderId(...) || tasks === undefined) return;
    if (!editingTask) {
        onClose();
    }
}, [editingTask, editingTaskId, onClose, tasks]);
```

`onClose` calls `form.resetFields()` and dispatches `closeModal()`. If another tab moves the task or a refetch elides it (filter change, optimistic delete from elsewhere), the user's in-flight title/notes edits vanish without a toast.

- **Why it matters:** This is the silent-revert smell `mobile-native-best-practices.md` §F.3 warns about. Worse, this is an *editor*, not a viewer.
- **Proposed fix:** When `editingTask` flips from defined to undefined while the form is dirty, switch to a sticky inline banner ("This task was deleted elsewhere — copy your changes before closing"), keep the modal open, mark the form read-only-ish. Only auto-close if `form.isFieldsTouched() === false`.

### 2. TaskCreator silently writes a canned template under the user's chosen name
- **Surface:** taskCreator
- **Severity:** High (everyone's first task action)
- **Type:** UX
- **Evidence:** `src/components/taskCreator/index.tsx:113-122`

```
await mutateAsync({
    taskName: trimmed,
    projectId, columnId,
    coordinatorId: user?._id,
    type: "Task",
    epic: "New Feature",
    storyPoints: 1,
    note: "No note yet"
});
```

- **Why it matters:** The user types "Fix sign-up bug" → server stores `type: "Task"` (not Bug), `epic: "New Feature"`, `note: "No note yet"`. Every follow-up edit in TaskModal is undoing this defaulting. The literal string `"No note yet"` even ends up rendered in card hovers if anything later relies on truthy `note`.
- **Proposed fix:** Send only the fields the user actually supplied. Make the server fill in `type=Task` and leave `epic`/`storyPoints`/`note` `undefined` (or the API should mark them optional). For "Bug" entries, parse a leading `[bug]` or `bug:` prefix; or — better — split the affordance into "Create task" and "Report bug" inline. The board already differentiates them visually (geekblue/magenta).

### 3. AuthErrorSummary auto-focuses on every render where it's visible
- **Surface:** authErrorSummary
- **Severity:** Medium-High (a11y + jank)
- **Type:** A11y / UX
- **Evidence:** `src/components/authErrorSummary/index.tsx:80-84`

```
useEffect(() => {
    if (visible) {
        ref.current?.focus();
    }
}, [visible, apiMessage, fieldErrors.length]);
```

The dependency array includes both `apiMessage` and `fieldErrors.length` — so adding a second field error (e.g., user blurs email, then blurs password) re-fires `focus()`, yanking the user out of the password field they just left.

Combined with the `<a href="#email" onClick preventDefault + focus()>` pattern (lines 116-121), the summary acts both as an alert region *and* an interaction trap.

- **Proposed fix:** Focus only on `visible` 0→1 transition (track `wasVisibleRef`). Keep the `aria-live="polite"` channel for subsequent updates so screen readers still hear new errors without the page scrolling. Also: the focus target should be the heading (`#auth-error-summary-title`), not the container `<div tabIndex={-1}>` — many SR users will hear "blank, alert" before they hear the title.

### 4. No browser-back-to-close on any modal; trade-off was accepted but never re-paid
- **Surface:** All overlays
- **Severity:** Medium-High (mobile expectation)
- **Type:** UX / mobile
- **Evidence:** `src/utils/hooks/_createOverlayHook.ts:14-24`

The comment is explicit: *"deep links to `?modal=on` and the back-button gesture no longer auto-open overlays."* This was a workaround for an iOS Safari React Router propagation bug. But it means:
- Android system back button closes the *app* (or pops a route) instead of closing the open modal.
- iOS edge-swipe-back navigates away with unsaved edits.
- Deep linking from notifications / chat to a specific task is impossible.

`mobile-native-best-practices.md` §Interaction red flags specifically calls this out: *"Broken back button in SPAs (Baymard 2024: 59 % of sites violate back-button expectations)."*

- **Proposed fix:** Layer a `history.pushState({ overlay: 'taskModal', id }, '')` shim on top of the Redux open: on `open`, push state; on `popstate`, dispatch close; on close, conditionally `history.back()` so the URL bar matches. This restores the back gesture without re-introducing the original iOS render bug. Pair with a one-line `<link rel="canonical">` swap for `/projects/:id?task=:id` so deep links resolve. This is the right place to start the inline-detail-panel migration (Ambitious #1).

### 5. ProjectModal's `destroyOnHidden={false}` keeps stale state in the form between create/edit cycles
- **Surface:** projectModal
- **Severity:** Medium
- **Type:** Correctness
- **Evidence:** `src/components/projectModal/index.tsx:106` + `:88-90`

`destroyOnHidden={false}` keeps the Modal mounted; the `useEffect` at line 88-90 only runs `form.setFieldsValue(editingProject)` when `editingProject` changes. If a user opens "Create project", types into the field, cancels, then clicks a row to "Edit", the create-side values are still in the form for the first paint until `setFieldsValue` runs (and they only get *merged*, not replaced — AntD's `setFieldsValue` is shallow).

- **Why it matters:** Users see flash of their cancelled draft over the project being edited.
- **Proposed fix:** Either `destroyOnHidden` (lose nothing — modal is light) or, before any `setFieldsValue`, call `form.resetFields()`. Better still: gate the `<Form>` element behind `isModalOpened` so it remounts.

### 6. TaskModal `form.getFieldsValue()` reads during render — desync between AI panel and live form
- **Surface:** taskModal
- **Severity:** Medium
- **Type:** Correctness / a11y
- **Evidence:** `src/components/taskModal/index.tsx:268-279`

```
const liveValues = (() => {
    const fromForm = form.getFieldsValue();
    return { taskName: fromForm.taskName ?? editingTask?.taskName, ... };
})();
void formTick;
```

The `formTick` ref pattern is a code smell: the component sets a counter on `onValuesChange` purely so this IIFE re-runs. AntD's recommended pattern here is `Form.useWatch("taskName", form)` per field — gives you a real subscription and avoids the "void formTick" pseudo-dep.

- **Why it matters:** Story-points suggestion in `AiTaskAssistPanel` is gated on `liveValues`. If `formTick` ever fails to bump (e.g., a future programmatic `setFieldValue` that bypasses `onValuesChange`), the panel will silently read stale values.
- **Proposed fix:** Replace with `useWatch` per field. Delete `formTick` and the `void` statement.

### 7. ProjectModal phone footer drops the destructive Delete entirely — no inline edit-delete on mobile
- **Surface:** projectModal
- **Severity:** Medium
- **Type:** Feature gap
- **Evidence:** `src/components/projectModal/index.tsx:128-143` (no Delete button at all)

Unlike TaskModal, ProjectModal never exposes Delete. Users have to leave the modal, navigate back to `/projects`, scroll to find the row, click the row's overflow menu (`projectList/index.tsx:201`). That's 4 steps to delete the project you're already editing.

- **Proposed fix:** Add a "Delete project" tertiary action in the modal footer (text button, danger, left-aligned), mirroring `TaskModal`'s pattern. Reuse `microcopy.confirm.deleteProject`.

### 8. Inline validation timing is asymmetric — TaskModal validates on submit, login/register validate on submit-attempt-then-blur (implicit AntD default)
- **Surface:** taskModal, projectModal, loginForm, registerForm
- **Severity:** Medium
- **Type:** UX consistency
- **Evidence:** No `validateTrigger` is set anywhere; AntD default is `onChange` for the first error and then continuous. Login uses `submitAttempted` to gate AuthErrorSummary inclusion of field errors; TaskModal has no equivalent.

The effect: a brand-new user on the register form sees "Email is required" the moment they tab past the empty field; the same user editing a task name sees "Task name is required" only when they hit Save.

- **Proposed fix:** Standardize on AntD's `validateTrigger={["onBlur", "onSubmit"]}` for required-field rules across all forms. The "show errors only after first submit" pattern (already in `submitAttempted`) should be generalized.

### 9. Modal viewport math relies on a fixed 220 px / 320 px chrome reservation that diverges from real device chrome
- **Surface:** taskModal, projectModal, aiTaskDraftModal
- **Severity:** Medium
- **Type:** Mobile correctness
- **Evidence:** `taskModal/index.tsx:422-424`, `projectModal/index.tsx:146-148`, `aiTaskDraftModal/index.tsx:461`:

```
maxHeight: screens.sm ? "calc(100dvh - 220px)" : "calc(100dvh - 320px)"
```

These literals were derived empirically from a Pixel-class viewport and a Save/Cancel/Delete stack. They don't account for:
- iOS keyboard open (consumes 270-380 px depending on landscape).
- `env(keyboard-inset-height)` (the property `aiChatDrawer` already uses).
- Large fonts / dynamic-type users (the title line that's `fontSize.lg` could wrap 3 lines, not 2).

When the keyboard is open on a phone, the body's `overflowY: auto` saves the day visually but the *footer buttons* (Save/Cancel/Delete) are below the fold and the user has to scroll the modal body just to reach Save — which is the exact thing the keyboard handling guidance (`mobile-native-best-practices.md` §D.5) warns against.

- **Proposed fix:** Switch to `maxHeight: calc(100dvh - var(--ant-modal-chrome, 220px) - env(keyboard-inset-height, 0px))` and let CSS handle the dynamic case. Better: convert to bottom-sheet (ambitious #2) where the footer is sticky above the keyboard naturally.

### 10. Member popover is read-only — no assignment, no invite, no @-mention
- **Surface:** memberPopover
- **Severity:** Medium (product gap)
- **Type:** Feature
- **Evidence:** `src/components/memberPopover/index.tsx:104-134` — pure list, no `onClick`, no Add button, no search.

The trigger says "Members" with an avatar group and count. The user clicks; they get a list of names; they cannot do anything from it. To invite or remove a member, they have to know where the project settings page lives (it doesn't appear to be wired up from the header). To assign a task to someone, they have to open the TaskModal and use the Coordinator dropdown.

- **Proposed fix:** Combine member-popover with an `@`-mention typeahead inside the Notes textarea (and AI chat composer). On click of an avatar, *focus the search input* (added) so the user can search a 20+-person team. Add an "Invite member" footer that opens the invite modal (if any).

### 11. Login form's "verifying session" creates an undisclosed re-network step
- **Surface:** loginForm
- **Severity:** Medium
- **Type:** UX micro
- **Evidence:** `src/components/loginForm/index.tsx:60-92`

After a successful POST `/auth/login`, the form **silently** re-fetches `/users` to confirm the cookie. If the second call fails (proxy hiccup, browser cookie policy), the user sees `loginCouldNotPersistSession` — which is the right behavior — but during the ~150-800 ms of the second call, the button reads `microcopy.actions.loggingIn` even though the login *succeeded*. The slow user thinks login is hung.

- **Proposed fix:** Either (a) split the button label — show "Logging in…" → "Confirming session…" → success; or (b) call the verify probe in the background after `navigate("/projects")` and only surface a sticky banner on `/projects` if it fails. (b) cuts the perceived login time in half on slow networks.

### 12. Caps-lock announcement is a polite live region — silently announces on every keypress
- **Surface:** loginForm, registerForm
- **Severity:** Low
- **Type:** A11y micro
- **Evidence:** `loginForm/index.tsx:144-153`, `registerForm/index.tsx:139-148`

The `<CapsLockSlot aria-live="polite" role="status">` updates on every `onKeyUp` — when the user releases capslock the slot empties; when they press a key with capslock on, it re-populates. VoiceOver/NVDA will narrate "Caps lock is on" potentially every few keystrokes if capslock is left on, drowning out the actual password feedback.

- **Proposed fix:** Update only on `capsLockOn` *transition* (use a `useEffect` with `[capsLockOn]` to set message text, debounced).

### 13. ColumnCreator commits on blur-with-content — silently posts on tab-out
- **Surface:** columnCreator
- **Severity:** Low
- **Type:** UX
- **Evidence:** `src/components/columnCreator/index.tsx:135-138`

```
onBlur={() => {
    if (!columnName.trim()) collapse();
}}
```

Blur with content does *nothing* — it doesn't collapse, and it doesn't commit. The Slot stays open with the typed text. The comment on line 75-77 says Enter is the explicit commit, but a returning user who types a column name then clicks elsewhere is left with an orphaned input that looks committable but isn't. The empty-collapse case is also surprising (you typed `   `, you blur, the input collapses but no toast).

- **Proposed fix:** On non-empty blur, commit (same as Enter). Or collapse the input back to the button and show an inline "Type a column name and press Enter" tooltip. Either is better than the current ambiguous state.

### 14. Modal Save button width changes between phone and tablet (block vs auto), but the order changes too — Save→Cancel→Delete on phone, Delete↔Cancel↔Save on tablet
- **Surface:** taskModal
- **Severity:** Low
- **Type:** Consistency
- **Evidence:** `src/components/taskModal/index.tsx:336-405`

The visual order flips: phone footer reads top-to-bottom *Save / Cancel / Delete*; tablet reads left-to-right *Delete | Cancel · Save*. The DOM order changes accordingly, which means keyboard tab order *also* flips. A user who learns "primary action is at the end of the modal" on desktop has to re-learn on phone. The intent (thumb-safety) is right; the inconsistency between primary-position is the issue.

- **Proposed fix:** Keep Save at the *bottom* on both — for phone keep your current stack, for desktop move Save below Cancel below Delete (or keep the right-side cluster but always put Save *rightmost*, never Delete-on-the-left). The "destructive last" reasoning applies to both form factors.

### 15. Project popover "Create project" footer is a normal Button — the popover doesn't close on its click
- **Surface:** projectPopover
- **Severity:** Low
- **Type:** UX micro
- **Evidence:** `src/components/projectPopover/index.tsx:127-130`

```
<NoPaddingButton onClick={openModal} type="link">
    {microcopy.actions.createProject}
</NoPaddingButton>
```

Opening the modal is correct, but the popover stays open behind it. AntD's `Popover` doesn't dismiss on inner-click by default. The modal that lands on top covers it, so the user doesn't see the orphan popover until they close the modal and find the popover still hanging.

- **Proposed fix:** Wrap the popover in `open` state and close it on the action click; or migrate to `Dropdown` (which auto-closes on `<Menu.Item>` click).

### 16. No drag-and-drop file attachments anywhere in TaskModal — no field for attachments at all
- **Surface:** taskModal
- **Severity:** Low (missing feature, not a regression)
- **Type:** Feature gap
- **Evidence:** No `Upload`, no `onDrop`, no `attachments` field in `taskName/note/type/epic/coordinatorId/storyPoints` (taskModal/index.tsx:69-84)

For a Jira-style task board this is a meaningful gap. Even paste-an-image-into-notes (which most modern editors support) isn't wired — the AntD `Input.TextArea` only accepts text.

- **Proposed fix:** Add a `react-dropzone` overlay on the modal body; on file drop, upload to `/api/attachments` and append a markdown link to `note`. Or: replace the `<TextArea>` with a Slate/ProseMirror editor that owns paste-image and drag-drop natively. This is bundle-cost and out-of-scope for *this* review but worth tracking.

### 17. No prevention of duplicate Save submissions during the AntD `confirmLoading` window — relies on button disable + AntD's own debouncer
- **Surface:** taskModal, projectModal
- **Severity:** Low (defense-in-depth)
- **Type:** Robustness
- **Evidence:** `taskModal/index.tsx:328` `disabled: !editingTask || uLoading`; `projectModal/index.tsx:108-112`

The button is disabled while `uLoading`, but a fast pre-load Enter keypress could double-submit. AntD's `Modal.onOk` calls our `onOk` directly without internal dedup. `useReactMutation` likely dedups but I'd verify.

- **Proposed fix:** Track an `inFlightRef = useRef(false)` in `onOk` / `onFinish`. Idempotency keys on the API layer is the cleaner fix.

## Ambitious redesign proposals

### A. Replace TaskModal with an inline/routed task detail panel
- **Current:** `TaskModal` is a 630-LOC centered AntD `Modal` mounted at the board page, opened by Redux state. Has its own delete, its own form, its own AI panel, its own footer-flip-on-mobile. No deep-link, no back-button-to-close, no body-scroll-lock benefits.
- **Direction:** Route-driven detail. `<Route path="/projects/:projectId/task/:taskId" element={<TaskDetailPanel />} />`. On desktop wide ≥ 1024 px the panel docks as a 480-px right rail next to the board (board re-flows columns, doesn't scroll under). On 768-1024 px it's a 90vw drawer from the right. On phone it's a full-screen route (slides up from bottom with View Transitions). The board card itself, when tapped on phone, navigates; no modal at all.
- **Payoff:** Free deep-link, free back-button-close, free swipe-to-next (next/prev task ids in URL → arrow nav), free body-scroll-not-locked, free system-share. Kills findings #1, #4, #5, #9 and half of #6. Eliminates 4 of the 12 surfaces' worth of mobile-footer special-casing.
- **Risk:** Need a "discard changes?" confirm on route-change-while-dirty (use `useBlocker` from React Router 7). Need to keep the board mounted in the background to preserve scroll/drag state — use a layout route, not full unmount.
- **Effort:** Medium-large. ~1 week of work. The TaskModal's `<Form>` is reusable as-is — only the chrome (Modal, footer, history) changes. The AI panel becomes an inline collapsible section instead of a hard-coded sibling.

### B. Convert ProjectModal + Create flow to a 2-step wizard with progressive disclosure
- **Current:** ProjectModal is a single 3-field flat form (`projectName`, `organization`, `managerId`) on the same modal whether creating or editing. The "manager" field is mandatory on create but the server ignores it (`projectModal/index.tsx:58-67` — there's even a TODO-shaped comment). On phone the form is exactly the same shape as desktop.
- **Direction:** Two-step wizard for create. Step 1 = name + organization (you immediately get an optimistic project on the dashboard). Step 2 (optional, skippable) = invite teammates / pick manager / starter columns. Edit re-uses Step 1 only. Mobile renders the wizard as a sequence of bottom-sheets that slide in horizontally; the "back" gesture takes you to Step 1 within the sheet.
- **Payoff:** Halves time-to-first-project. Removes the "manager is required but server ignores it" wart. Sets up the invite UX for the team-collaboration feature that the empty-state in MemberPopover (`memberPopover/index.tsx:107-111`) implies exists. Folds finding #7 (no delete in modal) into the edit step naturally.
- **Risk:** Wizard abandonment after step 1 = orphan projects with no manager. Solve with a server default (`managerId = creator`) which the code already does for `POST`.
- **Effort:** Medium. ~3 days. Most of the work is the step-transition animation, which can be View Transitions API for free.

### C. Magic-link first auth with password as fallback; "Try a demo workspace" zero-friction entry
- **Current:** Login is email + password, with caps-lock detection (`loginForm/index.tsx:179-185`), eye-toggle, "Forgot password" link, password-manager-friendly autocomplete. Register is the same shape + username + strength meter. AuthErrorSummary auto-focuses on every error update (finding #3). All correct, but it's two pages of typing for a tool a new user wants to evaluate in 60 seconds.
- **Direction:** Default the auth page to a single email field + "Continue" button. Send a magic link by default (one-tap from email). Password is collapsed under a "Use a password instead" link. New users get a "Try a demo workspace" CTA that creates an ephemeral sandbox project pre-populated with example tasks. Caps-lock detection is now relevant only in the password fallback (most users never see it).
- **Payoff:** Activation rate. Removes the password-strength meter, the cap-lock slot, the "forgot password" detour, AND the second-network-call session-verify (finding #11) — magic link inherently verifies cookie. The demo workspace is a separate kind of win: it lets product/marketing point at a live URL.
- **Risk:** Magic-link infrastructure (transactional email, token endpoint, expiry). For mature users a password is faster than email round-trip, so the fallback must stay first-class.
- **Effort:** Large. ~2 weeks across frontend + backend. Demo workspace alone is ~3 days.

### D. Inline status/priority/assignee chips on the card with single-tap cycle (no popover needed)
- **Current:** To change a task's coordinator, type, or story points, you open the modal, drill to the field, change the Select, hit Save, wait for the network. The card displays the chips but they're inert.
- **Direction:** Make every chip on the card an in-place control. Tap "Bug" chip → toggles to "Task" (only two options today). Tap "3 pts" → opens a popover roulette of {1,2,3,5,8,13}. Tap the coordinator avatar → opens a typeahead. All optimistic, all idempotent.
- **Payoff:** The most common edits (re-pointing, re-assigning) bypass the modal entirely. The modal becomes the "I'm going to write 3 paragraphs of acceptance criteria" surface, not the "I just want to change the type" surface. Synergistic with Ambition A — the inline-routed panel can handle the deep edits and the chips handle the snap edits.
- **Risk:** Conflict-resolution. Two users tap the same chip — last-write-wins is fine for the simple cases (status), but story-points needs a sensible merge. Touch hit-target on the smaller chips needs the 44-px lift.
- **Effort:** Small-medium per chip. ~2 days for all three. Reuses existing mutations.

## Quick wins (≤30 min each)

- **AuthErrorSummary: only focus on visible 0→1 transition** (finding #3). Track `wasVisibleRef`.
- **TaskCreator: stop hard-coding `note: "No note yet"` and `epic: "New Feature"`** (finding #2 — partial). At minimum send `undefined` so the server defaults apply.
- **TaskModal `formTick` → `Form.useWatch`** (finding #6).
- **ProjectModal: add `form.resetFields()` before `form.setFieldsValue(editingProject)`** (finding #5).
- **CapsLockSlot: only narrate on transition** (finding #12).
- **Modal max-height: subtract `env(keyboard-inset-height, 0px)` from the math** (finding #9).
- **ProjectPopover: close popover on "Create project" click** (finding #15).
- **ColumnCreator: commit on non-empty blur** (finding #13).
- **ProjectModal: add Delete project tertiary action** (finding #7), reuse copy from `microcopy.confirm.deleteProject`.
- **Standardize `validateTrigger={["onBlur", "onSubmit"]}` on required fields across all 4 forms** (finding #8).
- **Modal footers across all 3 modals: add `paddingBottom: max(${space.md}px, env(safe-area-inset-bottom))`** to clear the iPhone home indicator when the keyboard is closed.
- **TaskModal "Delete" button: render the destructive in the same DOM position on phone as on tablet** (finding #14) — only the layout changes, not the order.
