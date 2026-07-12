/**
 * Single source of truth for the coarse-pointer touch-target floor.
 *
 * WCAG 2.5.8 asks for a 44px minimum hit area on touch. Every interactive
 * `ui/*` primitive threads this class into its `cn(...)` so a phone tap
 * lands without zoom, while fine pointers keep the denser desktop height.
 * The colocated `declares a touch-target height` tests assert this exact
 * token is present on the rendered control — keeping the literal here means
 * a refactor that drops it fails those tests instead of silently
 * regressing. The `coarse:` variant is registered in `tailwind.config.ts`
 * (`@media (pointer: coarse)`).
 */
export const TOUCH_TARGET = "coarse:min-h-[44px]";
