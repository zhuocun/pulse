import styled from "@emotion/styled";
import React from "react";

import { blur, radius } from "../../theme/tokens";

/**
 * Shared frosted-glass surface (Phase 5 "Liquid Glass" — Wave 1 T2).
 *
 * Captures the recipe that previously lived inline on three callsites
 * (AiTaskAssistPanel, CopilotWelcomeBanner, CopilotDock body wash) so
 * the brand-defining glass treatment evolves from a single source of
 * truth as Wave 2+ ships motion + specular rims on top.
 *
 * Intensity ladder (existing `--glass-*` tokens — Wave 1 T1 owns the
 * token side, do not invent new ones here):
 *
 *   - `strong`  → opaque-leaning surface, deepest blur, accent-tinted
 *                 border, inset shine. Brand-defining hero glass
 *                 (AiTaskAssistPanel today; CopilotWelcomeBanner today).
 *   - `regular` → balanced default. Header / bottom-tab-bar recipe.
 *   - `subtle`  → faintest wash, light blur. Body washes / overlays
 *                 that sit on top of opaque chrome (CopilotDock today).
 *
 * Tone selects the optional gradient overlay layered over the base
 * glass surface:
 *
 *   - `neutral` → no overlay (just the translucent surface).
 *   - `aurora`  → linear-gradient(135deg, --aurora-blob-faint, transparent).
 *                 The "AiTaskAssistPanel today" recipe.
 *   - `accent`  → stacked aurora-blob-strong + aurora-blob layers — the
 *                 stronger brand wash the welcome banner ships today.
 *
 * Fallbacks (mandatory, mirrors the recipe header / bottomTabBar /
 * projectDetail.TopBar already ship):
 *
 *   - `@media (prefers-reduced-transparency: reduce)` → collapses to the
 *     opaque page background, drops blur + gradient.
 *   - `@media (forced-colors: active)` → `Canvas` background + 1 px
 *     `CanvasText` border, drops blur + gradient.
 *
 * Text inside the panel should sit in a content child so the
 * filtered/translucent root never antialiases the glyph edges
 * (Apple's "sub-pixel text degrades on filtered layers" rule).
 */

export type GlassPanelIntensity = "strong" | "regular" | "subtle";
export type GlassPanelTone = "neutral" | "aurora" | "accent";

export interface GlassPanelProps extends Omit<
    React.HTMLAttributes<HTMLElement>,
    "color"
> {
    intensity?: GlassPanelIntensity;
    tone?: GlassPanelTone;
    /**
     * Render under a different semantic tag. Defaults to `div`. Use
     * `section` / `aside` / `header` / `nav` for landmark semantics
     * when the panel anchors a region of the page.
     */
    as?: keyof React.JSX.IntrinsicElements;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}

interface GlassRootProps {
    $intensity: GlassPanelIntensity;
    $tone: GlassPanelTone;
}

/* -- Recipe maps ------------------------------------------------------- */

const INTENSITY_SURFACE: Record<GlassPanelIntensity, string> = {
    strong: "var(--glass-surface-strong)",
    regular: "var(--glass-surface)",
    subtle: "var(--glass-surface-subtle)"
};

const INTENSITY_BLUR_PX: Record<GlassPanelIntensity, number> = {
    strong: blur.md,
    regular: blur.md,
    subtle: blur.sm
};

const INTENSITY_SATURATION: Record<GlassPanelIntensity, string> = {
    strong: "170%",
    regular: "180%",
    subtle: "160%"
};

const INTENSITY_BORDER: Record<GlassPanelIntensity, string> = {
    strong: "var(--glass-border-strong)",
    regular: "var(--glass-border)",
    subtle: "var(--glass-border)"
};

/**
 * Drop shadow + inset shine. Only `strong` ships either — `regular` and
 * `subtle` stay quiet (header / dock-body parity). Within `strong`, the
 * `accent` tone gets a heavier drop because it carries the welcome-
 * banner's "stronger brand wash" semantics — pairing the heavier shadow
 * with the heavier overlay preserves the visual hierarchy that the two
 * pre-refactor surfaces shipped.
 *
 * The inset uses `var(--glass-shine)` so dark mode flips automatically
 * (the AiTaskAssistPanel original hard-coded the light-mode literal,
 * which silently degraded the highlight in dark mode — normalized).
 */
const INTENSITY_TONE_SHADOW: Record<
    GlassPanelIntensity,
    Record<GlassPanelTone, string>
> = {
    strong: {
        neutral: "0 4px 16px -8px var(--aurora-blob), var(--glass-shine)",
        aurora: "0 4px 16px -8px var(--aurora-blob), var(--glass-shine)",
        accent: "0 6px 20px -10px var(--aurora-blob-strong), var(--glass-shine)"
    },
    regular: { neutral: "none", aurora: "none", accent: "none" },
    subtle: { neutral: "none", aurora: "none", accent: "none" }
};

/**
 * Tone overlays. `aurora` matches the AiTaskAssistPanel recipe — a
 * single diagonal wash that fades by 70% so the right half of the
 * surface stays clear of the accent (the original 0%→100% spread
 * diluted the diagonal). `accent` stacks two layers — the welcome
 * banner's "richer warm cast" recipe; both layers terminate before
 * the full surface for the same reason.
 */
const TONE_OVERLAY: Record<GlassPanelTone, string> = {
    neutral: "",
    aurora: "linear-gradient(135deg, var(--aurora-blob-faint) 0%, transparent 70%), ",
    accent: [
        "linear-gradient(135deg, var(--aurora-blob-strong) 0%, transparent 75%)",
        "linear-gradient(45deg, var(--aurora-blob) 0%, transparent 60%)",
        ""
    ].join(", ")
};

/* -- Styled root ------------------------------------------------------- */

const GlassRoot = styled.div<GlassRootProps>`
    /*
     * Position relative so Wave 2 can attach a specular-rim ::before /
     * ::after layer without each caller re-asserting it. Two of the
     * three current callsites (AiTaskAssistPanel, CopilotDock body) do
     * not set position themselves; the welcome banner already did.
     */
    position: relative;
    background: ${(p) =>
        `${TONE_OVERLAY[p.$tone]}${INTENSITY_SURFACE[p.$intensity]}`};
    backdrop-filter: blur(${(p) => INTENSITY_BLUR_PX[p.$intensity]}px)
        saturate(${(p) => INTENSITY_SATURATION[p.$intensity]});
    -webkit-backdrop-filter: blur(${(p) => INTENSITY_BLUR_PX[p.$intensity]}px)
        saturate(${(p) => INTENSITY_SATURATION[p.$intensity]});
    border: 1px solid ${(p) => INTENSITY_BORDER[p.$intensity]};
    border-radius: ${radius.lg}px;
    box-shadow: ${(p) => INTENSITY_TONE_SHADOW[p.$intensity][p.$tone]};

    /*
     * Honor the user's reduced-transparency preference: collapse the
     * frosted glass surface to the solid page background and drop the
     * blur + gradient overlay. Mirrors the recipe header / bottom-tab
     * bar / projectDetail TopBar already ship.
     */
    @media (prefers-reduced-transparency: reduce) {
        background: var(--page-background);
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        box-shadow: none;
    }

    /*
     * Forced-colors mode (Windows high-contrast) replaces every author
     * colour with system tokens. Drop the translucent surface so the
     * system colour wins; keep the rounded chrome so the panel still
     * reads as a contained surface in high-contrast.
     */
    @media (forced-colors: active) {
        background: Canvas;
        border: 1px solid CanvasText;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        box-shadow: none;
    }
`;

/* -- Component --------------------------------------------------------- */

const GlassPanel = React.forwardRef<HTMLElement, GlassPanelProps>(
    (
        {
            intensity = "regular",
            tone = "neutral",
            as,
            className,
            style,
            children,
            ...rest
        },
        ref
    ) => (
        <GlassRoot
            $intensity={intensity}
            $tone={tone}
            // Emotion's `as` prop accepts any IntrinsicElements key; the
            // typing is intentionally loose so consumers can pick the
            // right semantic tag (`section`, `aside`, `header`, …)
            // without us hand-rolling a generic-polymorphic component.
            as={as as React.ElementType | undefined}
            className={className}
            data-glass-intensity={intensity}
            data-glass-tone={tone}
            // Marker for Wave 3 glass-on-glass collision handling: any
            // overlay AntD surface (popover / dropdown / etc.) that
            // opens with a glass ancestor will degrade to opaque so we
            // don't stack frost-on-frost. Apple's explicit "never glass
            // on glass" rule.
            data-glass-context="true"
            ref={ref as React.Ref<HTMLDivElement>}
            style={style}
            {...rest}
        >
            {children}
        </GlassRoot>
    )
);

GlassPanel.displayName = "GlassPanel";

export default GlassPanel;
