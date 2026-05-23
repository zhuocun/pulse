import styled from "@emotion/styled";
import { Tag } from "antd";
import React from "react";

import { aiTokens, chipShape } from "../../theme/aiTokens";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

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
 * `blue` / `default`) pass through to AntD's named Tag palette so the
 * existing contrast pairings are preserved. `red` was added beyond the
 * doc's first sketch because both `confidence` (Low band) and `risk`
 * (high) ship `red` in production — dropping it would silently weaken
 * a regression guard.
 *
 * Interactivity
 * -------------
 * `interactive={true}` renders a `<button type="button">` shape with the
 * matching ARIA role and `cursor: pointer` outline-offset focus ring;
 * otherwise the chip renders a passive AntD `<Tag>`. Either form forwards
 * `data-*`, `aria-*`, `onClick`, `onKeyDown`, refs, and the `style`
 * override untouched — the migration from each bespoke pill to this
 * component is meant to be invisible to the consuming surfaces.
 *
 * Motion
 * ------
 * Variants that pulse / glow (currently only `suggested` and `badge`) do
 * so only when `prefers-reduced-motion: no-preference` — the
 * `useReducedMotion` hook fields the media query so the animation is
 * silenced for users who asked the OS for less motion (WCAG 2.3.3).
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
     * raw-Tag variants). Passing this explicitly lets the consumer flag
     * state (e.g. risk = "red" for high, confidence = "green" for High).
     */
    tone?: CopilotChipTone;
    /**
     * When true the chip renders a `<button type="button">` and announces
     * itself with `role="button"`. When false (default) the chip is a
     * passive AntD `<Tag>` and the parent supplies any role override via
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

/**
 * Maps a `tone` value onto either the AntD `<Tag color>` enum (so the
 * named palette flows through) or `undefined` for the `purple` tone —
 * which we paint via CSS custom properties for dark-mode parity. The
 * undefined value tells `<Tag>` to render its colorless default surface,
 * and our styled wrapper paints the copilot bg / border / text on top.
 */
const TONE_ANTD_COLOR: Record<
    CopilotChipTone,
    "green" | "orange" | "red" | "blue" | "default" | undefined
> = {
    purple: undefined,
    green: "green",
    orange: "orange",
    red: "red",
    blue: "blue",
    default: "default"
};

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

interface StyledChipProps {
    tone: CopilotChipTone;
    interactive: boolean;
    compact: boolean;
    motion: boolean;
}

/**
 * Single styled root used for both `<button>` and `<Tag>` shapes. Emotion
 * applies the geometry as `&&` so it wins over AntD's own `.ant-tag`
 * declarations without resorting to `!important`. We deliberately keep
 * the rules small — color / surface tokens drive the look; nothing here
 * is variant-specific.
 */
const StyledChip = styled(Tag, {
    shouldForwardProp: (prop) =>
        prop !== "tone" &&
        prop !== "interactive" &&
        prop !== "compact" &&
        prop !== "motion"
})<StyledChipProps>`
    && {
        align-items: center;
        border-radius: ${chipShape.radius}px;
        display: inline-flex;
        font-size: ${chipShape.fontSize}px;
        font-weight: ${chipShape.fontWeight};
        gap: ${chipShape.gap}px;
        line-height: ${chipShape.lineHeight};
        margin-inline-end: 0;
        padding: ${chipShape.paddingBlock}px
            ${(props) =>
                props.compact
                    ? chipShape.paddingInlineCompact
                    : chipShape.paddingInline}px;
        ${(props) =>
            props.tone === "purple"
                ? `
            background: ${aiTokens.badgeBg};
            border-color: ${aiTokens.bgMedium};
            color: ${aiTokens.badge};
        `
                : ""}
        ${(props) => (props.interactive ? "cursor: pointer;" : "")}
    }

    ${(props) =>
        props.interactive
            ? `
        &&:hover,
        &&:focus-visible {
            outline: 2px solid var(--ant-color-primary, ${aiTokens.badge});
            outline-offset: 1px;
        }
    `
            : ""}

    ${(props) =>
        props.motion && props.tone === "purple"
            ? `
        @media (prefers-reduced-motion: no-preference) {
            transition: box-shadow 200ms ease;
        }
        &&:hover {
            box-shadow: 0 0 0 3px ${aiTokens.pulse};
        }
    `
            : ""}
`;

/**
 * Implementation note on the AntD `<Tag>` substrate: AntD renders Tag to
 * `<span class="ant-tag">` with the named `color` painting bg + border +
 * text. For the `purple` tone we pass `undefined` so AntD doesn't apply
 * any color preset, and our styled overrides paint the copilot palette
 * instead. For interactive chips we still render through `<Tag>` and lift
 * accessibility via `role="button"` + `tabIndex={0}` — that pattern was
 * already in production on `CitationChip` and `AiSuggestedBadge`, and it
 * round-trips correctly with React Testing Library's `getByRole("button")`.
 */
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
            ...rest
        } = props;
        const reduced = useReducedMotion();
        const resolvedTone = tone ?? VARIANT_DEFAULT_TONE[variant];
        const antdColor = TONE_ANTD_COLOR[resolvedTone];
        const resolvedRole = role ?? (interactive ? "button" : undefined);
        const resolvedTabIndex =
            tabIndex !== undefined ? tabIndex : interactive ? 0 : undefined;

        /*
         * AntD's `<Tag>` does not type a generic `ref` so we forward
         * through the styled wrapper instead. The HTMLElement
         * generic stays correct (Tag renders `<span>`) — consumers
         * that need the underlying node (focus, scroll-into-view)
         * still get a usable ref.
         */
        return (
            <StyledChip
                ref={ref as React.Ref<HTMLSpanElement>}
                color={antdColor}
                compact={compact}
                data-copilot-chip-variant={variant}
                data-copilot-chip-tone={resolvedTone}
                interactive={interactive}
                motion={!reduced}
                role={resolvedRole}
                tabIndex={resolvedTabIndex}
                tone={resolvedTone}
                {...rest}
            >
                {children}
            </StyledChip>
        );
    }
);

CopilotChip.displayName = "CopilotChip";

export default CopilotChip;
