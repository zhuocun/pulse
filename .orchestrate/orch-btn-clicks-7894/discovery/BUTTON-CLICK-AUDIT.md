# Button / click hit-target audit (`orch-btn-clicks`)

Read-only survey of the React app for patterns that swallow or mis-route clicks (stacking contexts, pseudo-element overlays, `@hello-pangea/dnd` interactive blocking, portals). Product code is referenced below; this file is the single descendant-facing catalog.

---

## 1. Executive summary

- **`@hello-pangea/dnd`**: Both production `Drag` usages set `disableInteractiveElementBlocking` because task cards render as native `<button>`s and columns host many controls; any **new** `Drag` wrapping interactive descendants without this flag is a primary regression vector (see `AGENTS.md`).
- **`ProjectCard` “card-as-link”**: `TitleLink` uses a full-card `::after` (positioned to the `Card` box); `MetaRow` and action `Button`s are explicitly raised with `z-index` — the **`HeaderRow`** side (avatar + org/title stack) has no comparable lift, so future interactive nodes there are the obvious stacking risk.
- **Intentionally non-blocking chrome**: `ColumnsViewport` gradient fades and the auth hero grid `::before` set `pointer-events: none` — good templates for any new decorative layers.
- **Broader chrome**: Sticky `TopBar` on `projectDetail` and the main `Header` both use `z-index: 10`; unlikely alone but worth checking if an invisible full-bleed sibling ever shares the same stacking context.
- **Secondary hypotheses**: Horizontal `scroll-snap` on the board column scroller + DnD gesture handling, and Ant Design Drawer/Modal mask / portal ordering — plausible when symptoms are route- or drawer-specific rather than a single component.

---

## 2. Inventory table

| Surface | Symptom | Suspected root | Files | Suggested fix pattern |
|--------|---------|----------------|-------|------------------------|
| Board task cards | Drag works but click never opens task / feels dead | RBD blocks drags starting on native interactive elements | `src/components/column/index.tsx` (`Drag` ~694–722), `src/components/dragAndDrop/index.tsx` | Keep `disableInteractiveElementBlocking` on `Drag` when `TaskCard` (`<button>`) is in the tree; see `AGENTS.md`. |
| Board columns | Interactions in header/actions flaky vs drag | Column wrapped in `Drag` with `detachDragHandle`; root is `ColumnContainer` (`div`) — usually OK; regression if `Draggable` props or a new overlay interfere | `src/pages/board.tsx` (`Drag` ~916–951), `src/components/column/index.tsx` (`ColumnContainer` ~58–106) | Preserve detached handle on the grip only; avoid putting a full-bleed absolutely positioned layer over the column without `pointer-events: none` or z-index plan. |
| Board horizontal scroller | Taps sometimes scroll or ignore | `scroll-snap-type`, touch momentum, competing DnD listeners | `src/pages/board.tsx` (`ColumnContainer` ~88–130) | UX/device repro first; tune `touch-action` / snap only with measured tradeoffs. |
| Project grid cards | Secondary actions dead; title area always navigates | Card-as-link `::after` stacking | `src/components/projectCard/index.tsx` (`TitleLink` ~109–142, `MetaRow` ~162–174, actions ~362–411) | Match existing fix: `position: relative; z-index` on rows that host controls; optional `pointer-events: none` on the pseudo with restored `auto` on children (if semantics allow). |
| Project card header | Clicks on left/header region always follow title link | Same overlay covers full `Card`; avatar is decorative today | `src/components/projectCard/index.tsx` | If avatar becomes interactive, give that subtree a higher stacking order than `TitleLink::after` (currently `z-index: 0` on pseudo). |
| Main layout modals | Rare “can’t click page” / focus oddities | AntD portal mask, multiple drawers | `src/layouts/mainLayout.tsx`, `src/components/taskModal/index.tsx`, `src/components/projectModal/index.tsx`, AI drawers | Compare open stacks; `getContainer`, `zIndex` from `src/theme/tokens.ts` (`zIndex.modal` / `drawer`); tests use `getContainer={false}` — see `src/__tests__/aiAccessibility.strict.test.tsx` intro. |
| Auth marketing hero | (Low) grid blocks clicks | Decor overlay | `src/layouts/authLayout.tsx` (`Hero` `::before` ~89–104) | Already `pointer-events: none` — keep for new hero effects. |
| Command palette / SR helpers | N/A for most users | Clipped absolute “screen reader only” nodes | `src/components/commandPalette/index.tsx` (`HiddenLabel` ~102–111), `src/components/authErrorSummary/index.tsx` (`SrOnly` ~48–57) | Ensure these never expand to full-bleed; current pattern is 1×1 clip. |

---

## 3. DnD audit (`Draggable` / `Drag` × native interactive descendants)

Central wrapper: `src/components/dragAndDrop/index.tsx` — re-exports `Drag` as `@hello-pangea/dnd`’s `Draggable` (~68–111).

| Location | Wrapper | `disableInteractiveElementBlocking` | Child tree includes native interactive? | Notes |
|---------|---------|-------------------------------------|----------------------------------------|-------|
| `src/pages/board.tsx` ~916–951 | `<Drag …>` | **Yes** | **Yes** — entire `Column` (`ColumnContainer`): header `button` / `Dropdown`, `TaskCreator` inputs, nested task `Drag`s | `detachDragHandle` keeps drag handle on `ColumnDragHandleButton` only (`src/components/column/index.tsx` ~644–653). |
| `src/components/column/index.tsx` ~694–722 | `<Drag …>` | **Yes** | **Yes** — `TaskCard` root is `TaskCardOuter` styled `button` (~197–252, ~493–578) | Comment at ~702–703 documents RBD + `<button>` interaction. |
| `src/components/dragAndDrop/index.test.tsx` | `<Drag>` fixtures | **No** (tests) | **No** — plain `<div>` children | Acceptable; not production. |
| `src/components/column/column-dnd.test.tsx` | `<Drag>` | **Yes** | Mocks / harness only | Not production. |

**Conclusion:** Every **production** `Drag` site in `src/` already passes `disableInteractiveElementBlocking`. Future `Drag` instances must repeat this whenever the cloned child subtree can render `button`, `input`, `a`, etc., per `AGENTS.md`.

---

## 4. Stacking audit (pseudo-elements & full-bleed layers)

| Element | Coverage | `pointer-events` | Notes |
|---------|----------|------------------|-------|
| `ColumnsViewport::before` / `::after` | Left/right gradient strips (`position: absolute`, top/bottom 0) | **`none`** (`src/pages/board.tsx` ~144–152) | Documented in comment ~134–137 — cite as pattern. |
| `authLayout` `Hero::before` | Full hero (`inset: 0`) grid texture | **`none`** (`src/layouts/authLayout.tsx` ~90–104) | `HeroInner` uses `z-index: 1` ~107–111 for content above decoration. |
| `ProjectCard` `TitleLink::after` | Full **`Card`** box (`top/right/bottom/left: 0`, `position: absolute`, `z-index: 0`) | **Default (receives hits)** — intentional for card-as-link | Containing block is `Card` (`position: relative` ~37–45). **`MetaRow`** `z-index: 1` (~162–174); favorite / overflow `Button`s `z-index: 2` (~391–407). **`HeaderRow`** has no z-index — verify if new controls are added beside the title. |
| `projectDetail` `TabsRow` `.ant-tabs-nav::before` | Ant Design tab rail | Border styled transparent, not a hit-layer | `src/pages/projectDetail.tsx` ~137–147 |
| Global `*` `::before` / `::after` | N/A | N/A | `src/App.css` ~82–86 — `box-sizing` only. |
| `mainLayout` `SkipLink` | Focus-only `position: absolute` off-screen | N/A | `src/layouts/mainLayout.tsx` ~48–68 — not a full-time overlay. |
| `AiChatDrawer` scroll FAB | `position: absolute` button | N/A | `src/components/aiChatDrawer/index.tsx` ~2126–2146 — local to chat body, `zIndex: 10` inline. |

**Ant Design / portals:** Drawers (`BoardBriefDrawer` ~634+, `AiChatDrawer`, `CopilotShell` ~160–174, `CommandPalette` ~715+) and modals (`TaskModal`, `ProjectModal`, `AiTaskDraftModal`) mount masks that capture clicks by design. Suspect when “nothing responds” only while a drawer is transitioning or when multiple overlays stack.

---

## 5. Reference snippets (good patterns)

**Non-blocking gradient chrome** — `ColumnsViewport`:

```133:177:src/pages/board.tsx
/**
 * Wrapper that paints subtle gradient fades at the left and right edges so
 * users can see — without scrolling — that more columns exist beyond the
 * viewport. The fades use `pointer-events: none` so they never block clicks
 * or drag-and-drop on the columns underneath.
 */
const ColumnsViewport = styled.div`
    flex: 1;
    min-height: 0;
    position: relative;

    &::before,
    &::after {
        content: "";
        bottom: 0;
        pointer-events: none;
        position: absolute;
        top: 0;
        width: ${themeSpace.lg}px;
        z-index: 1;
    }
    // ...
`;
```

**Card-as-link overlay + elevated meta/actions** — `ProjectCard`:

```109:174:src/components/projectCard/index.tsx
const TitleLink = styled(Link)`
    // ...
    &::after {
        bottom: 0;
        content: "";
        left: 0;
        position: absolute;
        right: 0;
        top: 0;
        z-index: 0;
    }
    // ...
`;

const MetaRow = styled.div`
    // ...
    position: relative;
    z-index: 1;
`;
```

**Task `Drag` + interactive blocking opt-out:**

```693:722:src/components/column/index.tsx
                                return (
                                    <Drag
                                        key={task._id || taskDragId}
                                        index={index}
                                        draggableId={taskDragId}
                                        isDragDisabled{/* ... */}
                                        // TaskCard renders a <button>, which @hello-pangea/dnd
                                        // refuses to drag from by default; opt out of that block.
                                        disableInteractiveElementBlocking
                                    >
                                        <TaskRowDragShell>
                                            <TaskCard
                                                // ...
                                            />
                                        </TaskRowDragShell>
                                    </Drag>
                                );
```

---

## 6. Prioritized fix order (for implementers)

1. **Grep gate / code review on new DnD**: Any new `<Drag>` or raw `Draggable` must be checked for `disableInteractiveElementBlocking` when descendants include native controls (`AGENTS.md` list). Current production is clean; regressions will be additive.
2. **`ProjectCard` stacking**: If clicks miss on header-adjacent controls, lift `HeaderRow` (or specific children) above `TitleLink::after` mirroring `MetaRow`, or narrow the pseudo-element’s box if product allows shrinking the link hit target.
3. **Reproduce-then-target chrome**: For board-only issues, capture viewport + pointer type; distinguish RBD vs horizontal scroll vs an invisible overlay (DevTools pointer-events highlight). For drawer/modals, log `document.querySelectorAll('.ant-modal-wrap, .ant-drawer')` during failure.

---

## Handoff

### Branch

`orch/orch-btn-clicks-7894/bootstrap-btn-clicks-ref`

### What I did

- Read `AGENTS.md` (DnD + TaskModal), `src/pages/board.tsx` (`ColumnsViewport`), `src/components/projectCard/index.tsx`, and grepped `src/` for `Drag` / `Draggable`, `disableInteractiveElementBlocking`, `pointer-events`, pseudo-elements, `z-index`, and full-bleed `inset`.
- Authored this audit under `.orchestrate/orch-btn-clicks-7894/discovery/` with inventory, DnD matrix, stacking table, line-anchored references, and implementer priority order.
- Did not modify `src/**`, `backend/**`, `docs/**`, or package manifests (read-only survey per worker brief).

### Measurements

- `(none)` — qualitative audit deliverable only.

### Verification

- `test -f .orchestrate/orch-btn-clicks-7894/discovery/BUTTON-CLICK-AUDIT.md`
- `git diff --stat` scoped to `.orchestrate/orch-btn-clicks-7894/discovery/` only

### Top fixes for sibling implementers

1. Guard every new `Drag` that wraps `button` / form controls with `disableInteractiveElementBlocking` (both live call sites already do — keep it that way).
2. When touching `ProjectCard`, treat `TitleLink::after` as a full-card hit catcher: keep controls in `MetaRow`-style elevated layers; extend the same discipline to `HeaderRow` if it gains interactive widgets.
3. Copy `ColumnsViewport` / auth hero `pointer-events: none` on any new decorative absolutely positioned / pseudo-element chrome so fades never supersede real controls.

### Notes

- Bootstrap path `BUTTON-CLICK-AUDIT.md` was absent in this workspace at worker start; this file subsumes that slot.
- No screen recording: no product code or visual fix was applied by this worker (documentation-only).
