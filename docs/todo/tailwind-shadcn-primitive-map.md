# Tailwind + shadcn/ui primitive map (S2)

The token-wired shadcn/ui primitive library lives in `src/components/ui/`.
Every primitive is Tailwind-only, dark-mode-correct via the `--ui-*` token
layer, axe-clean, and declares a ≥44px coarse-pointer touch target where it
renders an interactive control. This note is the porting reference for the
S3–S7 feature-migration workers: **which antd component maps to which
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
- The vars are namespaced `--ui-*` and are **independent of** `--ant-color-*`,
  so the primitives keep working after AntD is removed.
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

## Deliberate deviations from stock shadcn

- Hover/selected item surfaces in `Select` / `DropdownMenu` use the neutral
  `muted` token, **not** shadcn's stock `accent` token — in this repo `accent`
  is the bright AI gradient (see `theme/tokens.ts`), so reusing it would paint
  vivid orange item hovers. `accent-foreground` is intentionally not defined.
- z-index values are literal Tailwind arbitrary values that mirror the
  `zIndex` token ladder (`dropdown` 1050, `drawer` 1000, `modal` 1100) because
  class strings must be static for Tailwind JIT.
- Preflight stays OFF during AntD coexistence, so primitives always pair a
  `border` width utility with an explicit border-color utility
  (`border-input` / `border-border`); there is no global border reset.
