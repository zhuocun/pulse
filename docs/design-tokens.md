# Design tokens

Contributor reference for the app design system. **Implementation source of truth:** [`src/theme/tokens.ts`](../src/theme/tokens.ts) and [`src/theme/antdTheme.ts`](../src/theme/antdTheme.ts). **Palette switch:** one line in [`src/theme/palettes/index.ts`](../src/theme/palettes/index.ts) selects the active `palette`; color-derived exports in `tokens.ts` follow automatically.

## Rules

- Import scales and colors from `src/theme/tokens.ts` (or the small number of CSS helpers re-exported from `antdTheme.ts`). Avoid raw spacing hexes and ad-hoc `px` ladders in components unless there is a documented exception.
- Values are **CSS pixels** unless noted otherwise (the legacy `html { font-size: 62.5% }` pattern is gone).
- Glass surfaces must keep the `prefers-reduced-transparency` fallback wired in `App.css` (see comments on `glass` in `tokens.ts`). Modals intentionally do not use glass tokens.

## Scales (what lives in `tokens.ts`)

| Scale | Export | Notes |
| --- | --- | --- |
| **Space** | `space` | Stepped ladder `xxs` (4) → `xxxl` (64), in px. Used in layout, padding, and AntD component overrides. |
| **Radius** | `radius` | `xs`–`xl` plus `pill`. Maps to AntD `borderRadius*` globals and several component tokens. |
| **Palette / color** | `brand`, `accent`, `aurora`, `glass`, `semantic`, `shadow`, `blur`, `tag`, `avatarGradients` | Brand/accent/aurora/avatar gradients are **derived from** the active `palette` (see `palettes/`). `semantic` and glass neutrals are fixed hex/rgba choices tuned for AntD + surface treatment. |
| **Typography** | `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `fontFamily` | Base UI text uses `fontSize.base` (14). Heading steps map into AntD heading tokens in `buildAntdTheme`. |
| **Motion** | `motion`, `easing` | Durations in ms (`instant`, `short`, `medium`, `long`); curves for `standard` / `emphasized` / `decelerate`. AntD global motion duration slots are filled from these. |
| **Layers & chrome** | `zIndex` | Sticky, dropdown, drawer, modal, toast. |
| **Other** | `touchTargetMin`, `touchTargetCoarse`, `maxLineLengthCh`, `columnMinWidthRem`, `pageMaxWidthRem`, `modalGutterPx`, `modalWidthCss`, `breakpoints` | Cross-cutting layout and a11y helpers. |

## How Ant Design sees the same tokens (`antdTheme.ts`)

[`buildAntdTheme(mode, coarsePointer)`](../src/theme/antdTheme.ts) returns Ant Design v5+ `ThemeConfig`:

- **`token` (global):** `colorPrimary` / link colors from `brand`; `colorSuccess` / `colorWarning` / `colorError` from `semantic`; `borderRadius*` from `radius`; `fontFamily` / `fontSize*` / `lineHeight*` from the typography exports; `motionDurationFast|Mid|Slow` from `motion.short|medium|long`; `controlHeight*` uses `touchTargetCoarse` when `coarsePointer` so small controls still meet touch targets.
- **`components`:** Dense Jira-like tuning — e.g. `Button` padding uses `space`, `Modal` / `Card` / `Input` / `Select` / `Table` / `Tag` / `Tabs` / `Tooltip` / `Form` / `Alert` / `Popover` / `Dropdown` pull `space`, `radius`, `fontSize`, `fontWeight`, and mode-specific rgba strokes from the palette where needed.

`ConfigProvider` should receive the object from `buildAntdTheme`; see `src/utils/appProviders.tsx`.

## CSS gradients (outside AntD token object)

`antdTheme.ts` also exports `accentGradientCss` and `auroraGradientCss` for styled components that need a ready-made `linear-gradient` string built from the same `accent` / `aurora` tokens.

## Related docs

- UI plan and backlog: [`docs/todo/ui-todo.md`](todo/ui-todo.md)
