# Design tokens

Contributor reference for the app design system. The UI is Tailwind CSS + shadcn/ui (Radix primitives) — Ant Design and Emotion have been fully removed. **Implementation source of truth:** [`src/theme/tokens.ts`](../src/theme/tokens.ts) (scales + color tokens) and [`src/theme/tailwindBridge.ts`](../src/theme/tailwindBridge.ts) (derives the `--pulse-*` CSS vars and the matching `var(--pulse-*)` maps `tailwind.config.ts` consumes). **Palette switch:** one line in [`src/theme/palettes/index.ts`](../src/theme/palettes/index.ts) selects the active `palette`; color-derived exports in `tokens.ts` follow automatically.

## Rules

- Import scales and colors from `src/theme/tokens.ts`, or reach them as Tailwind utilities (they resolve to the same `--pulse-*` vars via `tailwindBridge.ts`). Avoid raw spacing hexes and ad-hoc `px` ladders in components unless there is a documented exception.
- Values are **CSS pixels** unless noted otherwise (the legacy `html { font-size: 62.5% }` pattern is gone).
- Glass surfaces must keep the `prefers-reduced-transparency` fallback wired in `App.css` (see comments on `glass` in `tokens.ts`). Modals intentionally do not use glass tokens.

## Scales (what lives in `tokens.ts`)

| Scale | Export | Notes |
| --- | --- | --- |
| **Space** | `space` | Stepped ladder `xxs` (4) → `xxxl` (64), in px. Bridged to `--pulse-space-*` and the Tailwind `p-*` / `gap-*` utilities. |
| **Radius** | `radius` | `xs`–`xl` plus `pill`. Bridged to `--pulse-radius-*` and the `rounded-*` utilities. |
| **Palette / color** | `brand`, `accent`, `aurora`, `glass`, `semantic`, `shadow`, `blur`, `tag`, `avatarGradients` | Brand/accent/aurora/avatar gradients are **derived from** the active `palette` (see `palettes/`) as `var(--pulse-*, <fallback>)` strings, so a palette swap re-colors them live. `semantic` and glass neutrals are fixed hex/rgba choices tuned for the surface treatment. |
| **Typography** | `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `fontFamily` | Base UI text uses `fontSize.base` (14). Bridged to `--pulse-font-size-*` / `--pulse-font-weight-*` / `--pulse-line-height-*`. |
| **Motion** | `motion`, `easing` | Durations in ms (`instant`, `short`, `medium`, `long`, …); curves for `standard` / `emphasized` / `decelerate`. Bridged to `--pulse-duration-*` / `--pulse-ease-*`. |
| **Layers & chrome** | `zIndex` | Sticky, dropdown, drawer, modal, toast. |
| **Other** | `touchTargetMin`, `touchTargetCoarse`, `maxLineLengthCh`, `columnMinWidthRem`, `pageMaxWidthRem`, `modalGutterPx`, `modalWidthCss`, `breakpoints` | Cross-cutting layout and a11y helpers. |

## How Tailwind / shadcn sees the same tokens

- **Tailwind bridge** ([`src/theme/tailwindBridge.ts`](../src/theme/tailwindBridge.ts)): derives, from the same token objects, a `--pulse-*` custom-property table (`tokenVarsCss`, injected once in `index.tsx`) plus `var(--pulse-*)` reference maps that `tailwind.config.ts` points at. A token edit flows to the utilities automatically — the two can never drift.
- **shadcn semantic colors** (`--ui-*`): HSL channel-triple vars (`--ui-background`, `--ui-primary`, `--ui-border`, …) defined in `@layer base` in `src/App.css`, with a light block and a `html[data-color-scheme="dark"]` override. `tailwind.config.ts` maps them as `hsl(var(--ui-…) / <alpha-value>)` so opacity modifiers work. The shadcn/ui primitives in `src/components/ui/` read these.
- **Palette + surface vars** ([`src/theme/palettes/cssVars.ts`](../src/theme/palettes/cssVars.ts)): emits the `--pulse-brand-*` / `--pulse-accent-*` and the app-owned surface tokens (`--pulse-text-*`, `--pulse-fill-*`, `--pulse-border`, `--pulse-bg-*`, `--pulse-error`, `--pulse-warning`) in both the light and `data-color-scheme="dark"` blocks, so they flip on the same `useColorScheme` switch and re-color per palette (`usePaletteTheme`).
- **Touch targets:** `touchTargetCoarse` (44 px) is applied via the `coarse:` Tailwind variant (`@media (pointer: coarse)`); the single source is `TOUCH_TARGET` in [`src/components/ui/touchTarget.ts`](../src/components/ui/touchTarget.ts).

## CSS gradients

Gradient strings live on the color tokens themselves in `tokens.ts`: `aurora.gradLine` (the single-stripe accent sweep) and the `accent` / `aurora` `var(--pulse-*)` stops feed styled surfaces and the `bg-gradient-*` utilities.

## Related docs

- UI plan and backlog: [`docs/todo/ui-todo.md`](todo/ui-todo.md)
