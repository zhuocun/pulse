import React from "react";

import { cn } from "@/lib/utils";

import { aiTokens } from "../../theme/aiTokens";

/**
 * Shared Copilot pill (PRD v3 §9.5 / 2026-05 review §Ambition 6).
 *
 * Six AI surfaces used to render their own pill component, each with
 * subtly different padding, font weight, gradient, and tone. The result
 * was visual drift across what should be a single Copilot language. This
 * component owns the chip geometry — radius, padding, font weight — and
 * exposes a curated `variant` × `tone` matrix so callers can't accidentally
 * re-introduce a one-off pill.
 *
 * Variants
 * --------
 * - `suggested`  — provenance ("Suggested by Copilot") badge.
 * - `citation`   — inline source footnote `[1]`, opens tooltip / popover.
 * - `confidence` — band + percentage from the structured-suggestion stack.
 * - `engine`     — local vs remote engine mode tag.
 * - `match`      — per-result search match strength.
 * - `risk`       — mutation risk band (low/med/high).
 * - `badge`      — generic fallback for new AI surfaces.
 *
 * Tones
 * -----
 * `purple` paints the brand-accent ring (via `--color-copilot-*` so dark
 * mode flips automatically); the other tones (`green` / `orange` / `red` /
 * `blue` / `default`) map onto the semantic token palette so the existing
 * contrast pairings are preserved.
 *
 * Interactivity
 * -------------
 * `interactive={true}` renders a `<button type="button">` shape with the
 * matching ARIA role and focus ring; otherwise the chip renders a passive
 * `<span>`. Either form forwards `data-*`, `aria-*`, `onClick`, `onKeyDown`,
 * refs, and the `style` override untouched — the migration from each bespoke
 * pill to this component is meant to be invisible to the consuming surfaces.
 *
 * Motion
 * ------
 * Variants painted in the `purple` tone glow on hover only under
 * `prefers-reduced-motion: no-preference` (the `motion-safe:` variant), so
 * the animation is silenced for users who asked the OS for less motion
 * (WCAG 2.3.3).
 */
export type CopilotChipVariant =
    | "badge"
    | "citation"
    | "confidence"
    | "engine"
    | "match"
    | "suggested"
    | "risk";

export type CopilotChipTone =
    | "purple"
    | "green"
    | "blue"
    | "orange"
    | "red"
    | "default";

export interface CopilotChipProps extends Omit<
    React.HTMLAttributes<HTMLElement>,
    "color"
> {
    variant: CopilotChipVariant;
    /**
     * Optional override. When omitted the variant picks a sensible default
     * (`purple` for `suggested` / `citation` / `badge`, `default` for the
     * neutral variants). Passing this explicitly lets the consumer flag
     * state (e.g. risk = "red" for high, confidence = "green" for High).
     */
    tone?: CopilotChipTone;
    /**
     * When true the chip renders a `<button type="button">` and announces
     * itself with `role="button"`. When false (default) the chip is a
     * passive `<span>` and the parent supplies any role override via
     * `role={...}`.
     */
    interactive?: boolean;
    /**
     * Compact chips shrink the inline padding so dense surfaces (a card
     * meta row, the chat-drawer source list) don't visibly bloat the row
     * height. The font and radius stay constant.
     */
    compact?: boolean;
    children?: React.ReactNode;
}

/** Default tone per variant. Consumers may override via the `tone` prop. */
const VARIANT_DEFAULT_TONE: Record<CopilotChipVariant, CopilotChipTone> = {
    badge: "purple",
    citation: "purple",
    suggested: "purple",
    confidence: "default",
    engine: "purple",
    match: "default",
    risk: "default"
};

/**
 * Non-purple tones map onto the semantic token palette (subtle surface +
 * matching text + border). The `purple` tone is painted separately via the
 * `--color-copilot-*` custom properties so it flips with the palette / dark
 * mode.
 */
const TONE_CLASS: Record<CopilotChipTone, string> = {
    purple: "",
    green: "border-success bg-successBg text-success",
    orange: "border-warning bg-warningBg text-warning",
    red: "border-error bg-errorBg text-error",
    blue: "border-info bg-infoBg text-info",
    default: "border-border bg-muted text-muted-foreground"
};

const CHIP_BASE = cn(
    "inline-flex items-center gap-xxs rounded-pill border font-semibold leading-none",
    "px-xs py-[1px] text-xs transition-colors"
);

const purpleStyle: React.CSSProperties = {
    backgroundColor: aiTokens.badgeBg,
    borderColor: aiTokens.bgMedium,
    color: aiTokens.badge
};

const CopilotChip = React.forwardRef<HTMLElement, CopilotChipProps>(
    (props, ref) => {
        const {
            variant,
            tone,
            interactive = false,
            compact = false,
            children,
            role,
            tabIndex,
            className,
            style,
            ...rest
        } = props;
        const resolvedTone = tone ?? VARIANT_DEFAULT_TONE[variant];
        const resolvedRole = role ?? (interactive ? "button" : undefined);
        const resolvedTabIndex =
            tabIndex !== undefined ? tabIndex : interactive ? 0 : undefined;

        const mergedClassName = cn(
            CHIP_BASE,
            compact && "px-[6px]",
            TONE_CLASS[resolvedTone],
            interactive &&
                cn(
                    "cursor-pointer focus-visible:outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    "hover:ring-2 hover:ring-ring hover:ring-offset-1"
                ),
            resolvedTone === "purple" &&
                "motion-safe:transition-shadow motion-safe:hover:shadow-[0_0_0_3px_var(--color-copilot-pulse)]",
            className
        );
        const mergedStyle =
            resolvedTone === "purple" ? { ...purpleStyle, ...style } : style;

        const shared = {
            className: mergedClassName,
            style: mergedStyle,
            role: resolvedRole,
            tabIndex: resolvedTabIndex,
            "data-copilot-chip-variant": variant,
            "data-copilot-chip-tone": resolvedTone,
            ...rest
        };

        if (interactive) {
            return (
                <button
                    ref={ref as React.Ref<HTMLButtonElement>}
                    type="button"
                    {...shared}
                >
                    {children}
                </button>
            );
        }
        return (
            <span ref={ref as React.Ref<HTMLSpanElement>} {...shared}>
                {children}
            </span>
        );
    }
);

CopilotChip.displayName = "CopilotChip";

export default CopilotChip;
