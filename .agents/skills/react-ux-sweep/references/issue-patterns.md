# UI/UX issue patterns to look for

Checklist while reviewing screenshots. Each entry: **what to look
for**, **likely root cause**, **fix direction**.

Patterns marked ⚠ have been hit and fixed in this repo — they tend
to recur in adjacent code. The rest are candidates worth checking
during a sweep.

## Theming

⚠ **Invisible text or unflipped surfaces in dark mode.** AntD's
`cssVar: { key: "ant" }` scopes variables to `:where(.ant)`. Styled
components reading `var(--ant-color-bg-container, #fff)` from outside
that cascade fall back to the hardcoded value. The repo pins `.ant`
onto `<html>` in `appProviders.tsx`; if a surface still doesn't flip,
look for a hardcoded hex/rgba in the styled rule itself.

⚠ **Page chrome (body, html, layout shells) reads AntD vars and
falls back.** Page-level surfaces should use `--pulse-bg-page` /
`--pulse-text-base` from `App.css`, not AntD vars.

⚠ **Gradients that don't blend with the page background in dark
mode.** The board's `ColumnsViewport::before/after` and the auth
layout's radial gradient read the page bg color and need
`var(--pulse-bg-page)`, not `var(--ant-color-bg-layout, #f7f8fb)`.

**Hardcoded brand colors.** Search styled rules for `#5e6ad2`,
`#0F1116`, `#F7F8FB` outside `theme/` — they should come from theme
tokens or `colorPrimary*`.

## Layout & overflow

⚠ **Page overflows past the viewport at desktop widths.** Symptom:
`fullPage` screenshot wider than the viewport. Cause: a CSS Grid
container with default `auto` track minimums grows to fit the widest
descendant (typically a kanban or wide table) and the sticky header
inherits the stretched track. Fix at the grid container with
`grid-template-columns: minmax(0, 1fr)` (and `min-width: 0` on the
inner flex item that holds the scroll region).

⚠ **`-webkit-line-clamp` doesn't truncate an unbreakable run, and
`min-width` on a flex lane is only a floor.** Symptom: a 120-char
single-token taskName (URL, commit hash) makes one kanban lane ~3×
wider than its mates; a 200-char project name produces a 4-line H1.
Cause: the clamp only engages once the run wraps, and `flex-basis:
auto` resolves to the child's max-content so `min-width: 18rem`
becomes a floor, not a width. Fix: `word-break: break-word` on the
clamping element **and**, for flex lanes, pin `width` and
`flex: 0 0 ${width}` so the lane stays at the intended size.

⚠ **Mobile filter rows reserve a tall empty slot above each input.**
`flex: 1 1 14rem` works in row direction (basis = width) but
reserves 14 rem of height in column direction. Fix:
`flex: 0 0 auto; width: 100%` at the column breakpoint, restore the
proportional basis at `md+` only.

**Action buttons clipped at the right edge.** A flex row's items
have `min-width: auto` and won't shrink below content size. Fix:
`flex-wrap: wrap` on the parent; `min-width: 0` plus an explicit
`flex` shorthand on each child.

## Mobile

**Stat cards too narrow at 320–390 px.** Three columns at the
smallest viewport leaves ~100 px per card; labels truncate under
values. Consider collapsing to one card per row at the smallest size
or shrinking the label ramp.

**Table columns clipped on mobile.** `projectList` already hides
columns 3 and 5 with CSS at `< sm`. Other tables should follow that
pattern (display: none for non-essential cells) rather than relying
on horizontal scroll.

## Visual disambiguation

⚠ **Two adjacent text inputs that look identical but do different
things.** AI semantic search and the plain text filter were both
bare AntD `<Input>`s. Fix: a distinct `prefix` icon — `AiSparkleIcon`
(brand color) for AI, `SearchOutlined` (tertiary text) for filter.

## Page titles & breadcrumbs

⚠ **Heading or `document.title` shows a stray suffix while data
loads.** Symptoms: " board" with a leading space, lowercase heading,
"undefined board". Cause: template strings like
`${currentProject?.projectName} board`. Fix: ternary with a static
fallback.

**Breadcrumb shows the URL segment instead of a friendly name.**
Same shape as above; check that the upstream query is mocked with
the right param name (`?projectId=`, not `?_id=`).

## Forms

**Free-text where a select would prevent typo-duplicates.** The
Create-project modal's `Organization` field is free-text but the
existing seed data already shows variants like "Dev team 1" /
"Dev Team 1". A select / autocomplete pulled from the existing list
would prevent the duplicates from accumulating.

## Anti-patterns to NOT "fix"

These look wrong but are correct:

- `useState(systemPrefersDark)` — lazy initializer; React calls it
  once.
- `flex: 1 1 14rem` inside a `flex-direction: row` parent — only a
  bug when the parent is column.
- `useTitle("Board")` later replaced by
  `useTitle(\`${name} board\`)`inside the same component — both
calls write to`document.title`, the later one wins.
- AntD `App component={false}` — intentional. The `html.ant`
  workaround in `appProviders.tsx` covers the cssVar cascade; don't
  remove it.
