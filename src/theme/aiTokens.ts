/**
 * AI design tokens (PRD v3 §9.5 X-R11). The string values resolve at runtime
 * via CSS custom properties injected from `src/theme/palettes/cssVars.ts`,
 * so dark mode flips automatically — components never need to read
 * `data-color-scheme`. Fallback hexes are derived from the active palette
 * so a palette swap re-tints the fallbacks too.
 *
 * The numeric tokens (durations, sizes) sit alongside so a single import
 * grabs everything an AI surface needs without pulling the whole token
 * surface area in.
 */

import { palette } from "./palettes";
import { fontSize, fontWeight, radius, space } from "./tokens";

export const aiTokens = {
    gradStart: `var(--color-copilot-grad-start, ${palette.aurora.deep})`,
    gradMid: `var(--color-copilot-grad-mid, ${palette.aurora.mid})`,
    gradEnd: `var(--color-copilot-grad-end, ${palette.aurora.light})`,
    bgSubtle: `var(--color-copilot-bg-subtle, rgba(${palette.accent.rgb}, 0.04))`,
    bgMedium: `var(--color-copilot-bg-medium, rgba(${palette.accent.rgb}, 0.14))`,
    badge: `var(--color-copilot-badge, ${palette.brand.primaryHover})`,
    badgeBg: `var(--color-copilot-badge-bg, rgba(${palette.accent.rgb}, 0.10))`,
    pulse: `var(--color-copilot-pulse, rgba(${palette.accent.rgb}, 0.45))`
} as const;

/**
 * Shape primitives for the shared `<CopilotChip>` (Ambition 6). Every AI
 * pill — provenance badge, citation, confidence, engine mode, match
 * strength, mutation risk — composes from this table so a font-weight or
 * radius tweak ripples to all six surfaces in one edit. Bespoke values
 * (the old `BadgeTag` / `Chip` styled-components in
 * `aiSuggestedBadge` / `citationChip`) used to drift by 1–2 px and a font
 * weight notch; pinning the geometry here is the audit fix.
 *
 * The `purple` ring is the brand-accent flavour (uses the copilot CSS
 * vars so dark mode flips and palette swaps re-tint). Other tones pass
 * through to AntD's named Tag colors (`green` / `orange` / `red` /
 * `default`) so the existing accessible contrast pairings are preserved.
 */
export const chipShape = {
    radius: radius.pill,
    paddingBlock: 1,
    paddingInline: space.xs,
    paddingInlineCompact: space.xxs + 2,
    fontSize: fontSize.xs - 1,
    fontWeight: fontWeight.semibold,
    lineHeight: 1,
    gap: space.xxs
} as const;

/** Streaming TTFT target in ms. Surfaces measure against this for AGENT_TTFT. */
export const TTFT_TARGET_MS = 700;

/** Max time without a stream chunk before the watchdog aborts (UA-R1). */
export const STREAM_WATCHDOG_MS = 30_000;

/** Toast undo window per PRD §7.4. */
export const UNDO_WINDOW_MS = 10_000;

/** Smart-cache TTL for the board brief per PRD B-R1. */
export const BRIEF_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Minimum interval between fingerprint-driven brief refetches (R-A M3).
 * Rapid board edits (drag-drop, inline rename, bulk add) all bump the
 * board fingerprint and used to burn a fresh provider call each time.
 * Gate the auto-refresh so consecutive changes within this window
 * collapse into a single trailing-edge refetch — the user still gets
 * up-to-date insight, the token bill stops bleeding.
 *
 * Manual refresh (the toolbar button) bypasses this gate entirely.
 */
export const BRIEF_AUTO_REFRESH_MIN_INTERVAL_MS = 30_000;

/**
 * Sparkle icon size scale (PRD S-R4). Maps to `width`/`height` in CSS px.
 */
export const sparkleSize = {
    sm: 14,
    md: 18,
    lg: 24
} as const;

export type SparkleSize = keyof typeof sparkleSize;
