# Tailwind + shadcn/ui primitive map (S2)

> **Status — migration complete (S3–S8.6 done, S9/S10 dependency purge landed).**
> Ant Design, `@ant-design/icons`, Emotion, and `framer-motion` are fully
> removed: zero runtime imports in `src`, and none in `package.json`. No
> `--ant-*` CSS variable is emitted or read at runtime anymore — every
> remaining `--ant-*` mention in the tree is a historical comment. The antd →
> primitive map below is retained as the porting reference and rationale.

The token-wired shadcn/ui primitive library lives in `src/components/ui/`.
Every primitive is Tailwind-only, dark-mode-correct via the `--ui-*` token
layer, axe-clean, and declares a ≥44px coarse-pointer touch target where it
renders an interactive control. This note is the porting reference the
feature-migration workers used: **which antd component maps to which
primitive, and the prop-mapping gotchas.**

Do **not** re-derive colors or touch targets in feature code — thread the
primitives' props and the `--ui-*` / `--pulse-*` tokens.

## Token layer (foundation for every primitive)

- shadcn semantic colors are HSL channel-triple CSS vars (`--ui-background`,
  `--ui-primary`, `--ui-muted-foreground`, `--ui-border`, …) defined in a
  `@layer base` block in `src/App.css` with a light block (`:root`,
  `html[data-color-scheme="light"]`) and a dark override
  (`html[data-color-scheme="dark"]`). They flip on the same
  `data-color-scheme` switch the rest of the app uses.
- `tailwind.config.ts` maps them to utilities as
  `hsl(var(--ui-…) / <alpha-value>)`, so opacity modifiers work
  (`bg-primary/90`, `bg-muted/50`, `border-destructive/50`).
- The vars are namespaced `--ui-*` and were **independent of** the old
  `--ant-color-*` layer, so the primitives kept working through AntD's removal.
- `primary` = the brand orange (`#EA580C`); `destructive` = the error red.
  The pre-existing `brand` / `accent` / `aurora` / semantic (`success`,
  `warning`, `info`) Tailwind colors are untouched.
- Touch target: the single source of truth is `TOUCH_TARGET`
  (`coarse:min-h-[44px]`) in `src/components/ui/touchTarget.ts`. The `coarse:`
  variant is `@media (pointer: coarse)` (registered in `tailwind.config.ts`).

## antd → primitive map

| antd | primitive (`src/components/ui/…`) | Prop-mapping gotchas |
| --- | --- | --- |
| `Button` | `button` → `Button` | Label is `children` (or `aria-label` for icon-only) — never baked in; pass `microcopy.actions.*` exactly as before. `type="primary"` → `variant="primary"`; `type="default"` → `variant="default"`; `type="link"` → `variant="link"`; `danger` → `variant="destructive"`. `loading` and `block` are supported. `htmlType="submit"` → plain `type="submit"`. `icon={<X/>}` → put the icon as a child (auto-sized via `[&_svg]`). `size="large"` → `size="lg"`. |
| `Input` | `input` → `Input` | Plain themed `<input>`. `size="large"` is dropped — height is fixed and coarse-pointer safe. **No `Input.Password` / affix wrapper**: compose the eye-toggle / prefix as a sibling adornment in the caller (lucide `Eye`/`EyeOff`). `onPressEnter` → `onKeyDown` check for `Enter`. |
| `Input.TextArea` | `textarea` → `Textarea` | `autoSize` not implemented; set rows/height via `className`. |
| `Select` (single) | `select` → `Select` + `SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` | `options={[{label,value}]}` → map to `<SelectItem value>` children. `value`/`onChange` → `value`/`onValueChange` (emits the raw value, not an event). `showSearch`/`optionFilterProp` **not** ported (compose a `Command`-style filter later if needed). `placeholder` → `<SelectValue placeholder>`. Multi-select is not covered. |
| `Modal` | `dialog` → `Dialog` + `DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter` | `open`/`onCancel` → `open`/`onOpenChange`. `title` → `<DialogTitle>` (required for a11y name). `footer` → `<DialogFooter>` children. `okText`/`cancelText` become explicit `<Button>`s in the footer. Close button's `aria-label` comes from `microcopy.actions.close`. z-index = `zIndex.modal` (1100). Always render a `DialogTitle` (+ `DialogDescription`) so axe passes. |
| `Drawer` | `sheet` → `Sheet` + `SheetContent side=…` | `placement` → `side` (`right`/`left`/`top`/`bottom`). `open`/`onClose` → `open`/`onOpenChange`. z-index = `zIndex.drawer` (1000) so a `Dialog` stacks above it. Include `SheetTitle`. |
| `Tabs` | `tabs` → `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` | `items={[{key,label,children}]}` → composed triggers + content. `activeKey`/`onChange` → `value`/`onValueChange`. Selection follows **mousedown/focus** (Radix), not a bare click — matters for tests (`fireEvent.mouseDown`). |
| `Tooltip` | `tooltip` → `TooltipProvider` + `Tooltip`/`TooltipTrigger`/`TooltipContent` | Mount one `TooltipProvider` near the root. `title` → `<TooltipContent>`. Trigger must be focusable (wrap non-buttons with `asChild`). |
| `Popover` | `popover` → `Popover`/`PopoverTrigger`/`PopoverContent` | `content` → `<PopoverContent>` (role `dialog`; add `aria-label` for an accessible name). `trigger="click"` is the default. |
| `Dropdown` + `Menu` | `dropdown-menu` → `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem` | `menu={{items}}` → composed `<DropdownMenuItem>`. Per-item `onClick` → `onSelect`. `CheckboxItem`/`RadioItem`/`Sub*`/`Label`/`Separator` available. |
| `Tag` | `badge` → `Badge` | Non-interactive. `color` → `variant` (`default`/`secondary`/`destructive`/`outline`/`success`/`warning`/`info`). Closable/checkable tags: compose a `Button` next to the `Badge`. antd's geekblue/magenta/purple task-type colors are a feature-layer concern — pick a `variant` or a `className`. |
| `Alert` | `alert` → `Alert` + `AlertTitle`/`AlertDescription` | `type` → `variant` (`info`/`success`/`warning`/`error`→`destructive`; default). `message` → `<AlertTitle>`, `description` → `<AlertDescription>`. `showIcon` → drop a lucide icon as the first child (auto-positioned). `closable` → compose a close `Button`. |
| `Avatar` | `avatar` → `Avatar` + `AvatarImage`/`AvatarFallback` | `src` → `<AvatarImage src alt>`, initials/monogram → `<AvatarFallback>`. Size via `className` (`size-8`, etc.). |
| `Card` | `card` → `Card` + `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter` | `title`/`extra` → compose in `CardHeader`. `bordered` is the default. |
| `Divider` | `separator` → `Separator` | `type="vertical"` → `orientation="vertical"`. Decorative by default. |
| `Switch` | `switch` → `Switch` | `checked`/`onChange(bool)` → `checked`/`onCheckedChange(bool)`. `role="switch"` carries the 44px coarse floor. |
| `Checkbox` | `checkbox` → `Checkbox` | `checked`/`onChange(e)` → `checked`/`onCheckedChange(bool)` (emits a boolean, not an event). |
| `Radio.Group` | `radio-group` → `RadioGroup` + `RadioGroupItem` | `options`/`value`/`onChange` → composed items + `value`/`onValueChange`. |
| `Segmented` | `toggle-group` → `ToggleGroup` + `ToggleGroupItem` | `options`/`value`/`onChange` → composed items + `value`/`onValueChange`. Defaults to `type="single"`; pass `type="multiple"` for a multi-toggle. Single-select items are `role="radio"`. |
| `Table` | `table` → `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` | Presentational only — the `columns`/`dataSource` render model and sort/pagination are **not** ported; compose semantic rows, add data-grid behavior at the feature layer. |
| `Spin` | `spinner` → `Spinner` (active) + `skeleton` → `Skeleton` (placeholder) | `Spin spinning` wrapper → render `Spinner` (a live `role="status"` region; pass `label`) or `Skeleton` blocks for content-shaped loading. |
| `Empty` | `empty` → `Empty` | `description` → `description` prop; add `title`, `icon`, `action`. No baked-in copy — pass `microcopy.*`. |
| `Typography.{Title,Text,Paragraph}` | `typography` → `Typography.{Title,Text,Paragraph}` | `Title level={1..5}` preserved. `Text type="secondary"/"success"/"warning"/"danger"` preserved; `strong` supported. |
| `Form` / `Form.Item` / `Form.useForm` / `Form.useWatch` | `form` → `Form` / `Form.Item` / `Form.useForm` / `Form.useWatch` | See the Form section below. |
| `message` (via `useAppMessage`) | `toast` → `message` / `useAppMessage` / `Toaster` | See the Toast section below. |

## Form (antd-compatible subset)

`src/components/ui/form.tsx` reproduces the *smallest* antd surface the four
inspected callers (`loginForm`, `registerForm`, `projectModal`, `taskCreator`)
use. Migration = **swap the import path**, keep the JSX.

Supported: `const [form] = Form.useForm<Values>()`, `<Form form layout
onFinish onFinishFailed initialValues>`, `<Form.Item name label rules
validateTrigger extra help required>`, `Form.useWatch(name, form)`, and
`form.submit / resetFields / setFieldsValue / setFieldValue / getFieldsValue /
getFieldValue / isFieldsTouched / validateFields`.

Rule subset: `required`, `whitespace`, `type: "email"`, `min`, `max`, `len`,
`pattern`, and a `validator(value) => string | undefined`.

Control-wiring gotcha (the important one): `Form.Item` clones its single child
and injects `valuePropName` (default `value`) + `trigger` (default
`onChange`), antd-style. Native inputs (`Input`, `Textarea`) work with no extra
props. For the value-emitting Radix primitives, pass the pair explicitly:

- `Select`: `<Form.Item trigger="onValueChange">` (valuePropName stays `value`).
- `Checkbox` / `Switch`: `<Form.Item valuePropName="checked" trigger="onCheckedChange" getValueFromEvent={(v) => v}>`.
- `RadioGroup` / `ToggleGroup`: `<Form.Item trigger="onValueChange">`.

Not ported: nested `name` paths (arrays), `dependencies`, `List`, async
validators, and antd's field-level `validateStatus`/`hasFeedback` icons. The
error message renders as a `role="alert"` line; `extra`/`help` render as a
muted hint when there's no error (matching the login/register caps-lock slot).

## Toast (sonner-backed `message`)

`src/components/ui/toast.tsx` replaces `src/utils/hooks/useAppMessage.ts` with
the same ergonomics — migration is an import-path swap:

```ts
import useAppMessage from "@/components/ui/toast"; // was ".../hooks/useAppMessage"
const message = useAppMessage();
message.success(microcopy.feedback.saved);
```

- `message.{success,error,info,warning,loading}` accept the antd shapes:
  `(content)`, `(content, durationSeconds, onClose?)`, or a config object
  `({ content, duration, key, description, icon, onClose })`. Duration is antd
  **seconds** (0 = sticky) and is converted to sonner ms internally.
- Each method returns a `hide()` thunk (like antd). `message.destroy(key?)`
  dismisses one or all.
- **Test-safe fallback**: every method no-ops until a `<Toaster>` is mounted
  (tracked by a module counter; `resetToastersForTests()` resets it). This
  mirrors the old hook — a component rendered in isolation can call `message.*`
  without a provider and without throwing.
- `appProviders.tsx` now mounts our themed `<Toaster>` (wrapping sonner's) in
  place of the raw sonner `Toaster`, so production toasts render and the
  counter is accurate.
- `useUndoToast` (the interactive Undo toast) is a separate feature hook and is
  **out of scope** here; migrate it when its route migrates.

## S8.5a — `--ant-color-*` → app-owned token map (page/layout migration) — **done**

The pages/layouts used to read AntD's `--ant-*` custom properties directly.
S8.5a landed app-owned `--pulse-*` equivalents; S8.5/S8.6 then repointed every
page off the `--ant-*` namespace, and S8.6 removed the AntD runtime. Pages now
read the `--pulse-*` tokens directly — no `--ant-*` variable is emitted or
consumed at runtime. The map below is the historical record of what mapped to
what.

**Where they live.** The typed source of truth is `src/theme/tokens.ts`
(`text` / `fill` / `border` / `bg` / `status` exports + `brand.link`), each a
`var(--pulse-*, <light fallback>)` reference. The runtime CSS vars are emitted
by `src/theme/palettes/cssVars.ts` in **both** the light and dark
`html[data-color-scheme]` blocks, so they flip on the same
`useColorScheme` switch and re-color per palette (`usePaletteTheme`) exactly
like the rest of the `--pulse-*` surface. Do **not** add new `--ant-*` names.

**Faithfulness.** The pre-existing page fallbacks (e.g. `rgba(15, 23, 42, 0.6)`)
were approximations that never fired — AntD always defined the var, so the
pixel the user saw was AntD's algorithm output. The `--pulse-*` values below
mirror AntD's actual light/dark output at the opacities the chrome renders, so
a repointed page lands pixel-for-pixel. The one intentional shift:
`--ant-color-text` → `--pulse-text-base` adopts the design's canonical slate
ink (`rgba(15, 23, 42, 0.92)`, already the `body` text colour) instead of
AntD's `rgba(0, 0, 0, 0.88)`.

| `--ant-*` (read by pages/layouts) | app-owned var (`cssVars.ts`) | `tokens.ts` accessor | light value | dark value |
| --- | --- | --- | --- | --- |
| `--ant-color-text` | `--pulse-text-base` *(pre-existing)* | `text.base` | `rgba(15, 23, 42, 0.92)` | `rgba(229, 231, 235, 0.92)` |
| `--ant-color-text-secondary` | `--pulse-text-secondary` | `text.secondary` | `rgba(15, 23, 42, 0.65)` | `rgba(229, 231, 235, 0.65)` |
| `--ant-color-text-tertiary` | `--pulse-text-tertiary` | `text.tertiary` | `rgba(15, 23, 42, 0.45)` | `rgba(229, 231, 235, 0.45)` |
| `--ant-color-fill` | `--pulse-fill` | `fill.base` | `rgba(15, 23, 42, 0.15)` | `rgba(255, 255, 255, 0.18)` |
| `--ant-color-fill-secondary` | `--pulse-fill-secondary` | `fill.secondary` | `rgba(15, 23, 42, 0.06)` | `rgba(255, 255, 255, 0.12)` |
| `--ant-color-fill-tertiary` | `--pulse-fill-tertiary` | `fill.tertiary` | `rgba(15, 23, 42, 0.04)` | `rgba(255, 255, 255, 0.08)` |
| `--ant-color-fill-quaternary` | `--pulse-fill-quaternary` | `fill.quaternary` | `rgba(15, 23, 42, 0.02)` | `rgba(255, 255, 255, 0.04)` |
| `--ant-color-border` | `--pulse-border` | `border.base` | `rgba(15, 23, 42, 0.12)` | `rgba(255, 255, 255, 0.14)` |
| `--ant-color-border-secondary` | `--pulse-border-secondary` | `border.secondary` | `rgba(15, 23, 42, 0.06)` | `rgba(255, 255, 255, 0.08)` |
| `--ant-color-bg-container` | `--pulse-bg-container` | `bg.container` | `#ffffff` | `#141414` |
| `--ant-color-bg-elevated` | `--pulse-bg-elevated` | `bg.elevated` | `#ffffff` | `#1f1f1f` |
| `--ant-color-bg-text-hover` | `--pulse-bg-text-hover` | `bg.textHover` | `rgba(15, 23, 42, 0.06)` | `rgba(255, 255, 255, 0.12)` |
| `--ant-color-bg-text-active` | `--pulse-bg-text-active` | `bg.textActive` | `rgba(15, 23, 42, 0.15)` | `rgba(255, 255, 255, 0.18)` |
| `--ant-color-primary` | `--pulse-brand-primary` *(pre-existing)* | `brand.primary` | `palette.brand.primary` | `palette.brand.primary` |
| `--ant-color-primary-hover` | `--pulse-brand-primary-hover` *(pre-existing)* | `brand.primaryHover` | `palette.brand.primaryHover` | `palette.brand.primaryHover` |
| `--ant-color-primary-active` | `--pulse-brand-primary-active` *(pre-existing)* | `brand.primaryActive` | `palette.brand.primaryActive` | `palette.brand.primaryActive` |
| `--ant-color-primary-bg` | `--pulse-brand-primary-bg` *(pre-existing)* | `brand.primaryBg` | `palette.brand.primaryBg` | `palette.brand.primaryBg` |
| `--ant-color-link` | `--pulse-link` | `brand.link` | `palette.brand.primaryHover` | `palette.brand.primaryDark` |
| `--ant-color-info` | `--pulse-brand-primary` *(AntD defines `colorInfo` as the brand primary)* | `brand.primary` | `palette.brand.primary` | `palette.brand.primary` |
| `--ant-color-error` | `--pulse-error` | `status.error` | `#EF4444` | `#CE3D3D` |
| `--ant-color-warning` | `--pulse-warning` | `status.warning` | `#F59E0B` | `#D3890C` |

**Formerly app-owned `--ant-*` vars — now on the `--pulse-*` namespace.**
A set of glass / motion / chrome custom properties were app-owned despite the
`--ant-` prefix (the backdrop-filter ladder, the tab-bar-minimize and detent
motion tokens, the detent-snap easing, the glass lifted shadow, the mobile
chrome inset, and the link colour). During AntD's removal these were renamed
into the `--pulse-*` namespace (e.g. `--pulse-backdrop-filter-glass`,
`--pulse-link`) so the tree carries a single custom-property namespace and no
`--ant-*` variable remains at runtime.

## Deliberate deviations from stock shadcn

- Hover/selected item surfaces in `Select` / `DropdownMenu` use the neutral
  `muted` token, **not** shadcn's stock `accent` token — in this repo `accent`
  is the bright AI gradient (see `theme/tokens.ts`), so reusing it would paint
  vivid orange item hovers. `accent-foreground` is intentionally not defined.
- z-index values are literal Tailwind arbitrary values that mirror the
  `zIndex` token ladder (`dropdown` 1050, `drawer` 1000, `modal` 1100) because
  class strings must be static for Tailwind JIT.
- Preflight is ON now that AntD is fully removed. Primitives still pair a
  `border` width utility with an explicit border-color utility
  (`border-input` / `border-border`) so a `ui/*` subtree always reads the
  theme border rather than `currentColor`.
