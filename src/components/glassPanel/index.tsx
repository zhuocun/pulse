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
 * Only the `strong` intensity ships the inset shine + accent drop —
 * matches the AiTaskAssistPanel / welcome-banner recipe. Regular and
 * subtle stay quiet (header / dock-body parity).
 *
 * The inset uses `var(--glass-shine)` so dark mode flips automatically
 * (the AiTaskAssistPanel original hard-coded the light-mode literal,
 * which silently degraded the highlight in dark mode — normalized).
 */
const INTENSITY_SHADOW: Record<GlassPanelIntensity, string> = {
    strong: "0 4px 16px -8px var(--aurora-blob), var(--glass-shine)",
    regular: "none",
    subtle: "none"
};

/**
 * Tone overlays. `accent` stacks two aurora layers — the welcome
 * banner's "richer warm cast" recipe; `aurora` is the single subtle
 * gradient the task-assist panel uses today.
 */
const TONE_OVERLAY: Record<GlassPanelTone, string> = {
    neutral: "",
    aurora: "linear-gradient(135deg, var(--aurora-blob-faint), transparent), ",
    accent: [
        "linear-gradient(135deg, var(--aurora-blob-strong) 0%, transparent 75%)",
        "linear-gradient(45deg, var(--aurora-blob) 0%, transparent 60%)",
        ""
    ].join(", ")
};

/* -- Styled root ------------------------------------------------------- */

const GlassRoot = styled.div<GlassRootProps>`
    background: ${(p) =>
        `${TONE_OVERLAY[p.$tone]}${INTENSITY_SURFACE[p.$intensity]}`};
    backdrop-filter: blur(${(p) => INTENSITY_BLUR_PX[p.$intensity]}px)
        saturate(${(p) => INTENSITY_SATURATION[p.$intensity]});
    -webkit-backdrop-filter: blur(${(p) => INTENSITY_BLUR_PX[p.$intensity]}px)
        saturate(${(p) => INTENSITY_SATURATION[p.$intensity]});
    border: 1px solid ${(p) => INTENSITY_BORDER[p.$intensity]};
    border-radius: ${radius.lg}px;
    box-shadow: ${(p) => INTENSITY_SHADOW[p.$intensity]};

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
