import React from "react";

import { cn } from "@/lib/utils";

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
 * projectDetail.TopBar already ship): `prefers-reduced-transparency`
 * collapses to the opaque page background and drops the blur + gradient;
 * `forced-colors: active` swaps to system tokens.
 *
 * The dynamic surface/filter/border/shadow are threaded as `--gp-*` CSS
 * custom properties so the reduced-transparency / forced-colors Tailwind
 * variants can still override the painted result (inline values would
 * otherwise win over the utility classes).
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

/* -- Recipe maps ------------------------------------------------------- */

const INTENSITY_SURFACE: Record<GlassPanelIntensity, string> = {
    strong: "var(--glass-surface-strong)",
    regular: "var(--glass-surface)",
    subtle: "var(--glass-surface-subtle)"
};

const INTENSITY_BACKDROP_FILTER: Record<GlassPanelIntensity, string> = {
    strong: "var(--ant-backdrop-filter-glass)",
    regular: "var(--ant-backdrop-filter-glass)",
    subtle: "var(--ant-backdrop-filter-glass-subtle)"
};

const INTENSITY_BORDER: Record<GlassPanelIntensity, string> = {
    strong: "var(--glass-border-strong)",
    regular: "var(--glass-border)",
    subtle: "var(--glass-border)"
};

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

const TONE_OVERLAY: Record<GlassPanelTone, string> = {
    neutral: "",
    aurora: "linear-gradient(135deg, var(--aurora-blob-faint) 0%, transparent 70%), ",
    accent: [
        "linear-gradient(135deg, var(--aurora-blob-strong) 0%, transparent 75%)",
        "linear-gradient(45deg, var(--aurora-blob) 0%, transparent 60%)",
        ""
    ].join(", ")
};

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
    ) => {
        const Comp = (as ?? "div") as React.ElementType;
        const cssVars = {
            "--gp-bg": `${TONE_OVERLAY[tone]}${INTENSITY_SURFACE[intensity]}`,
            "--gp-filter": INTENSITY_BACKDROP_FILTER[intensity],
            "--gp-border": INTENSITY_BORDER[intensity],
            "--gp-shadow": INTENSITY_TONE_SHADOW[intensity][tone]
        } as React.CSSProperties;
        return (
            <Comp
                className={cn(
                    "relative rounded-lg border [background:var(--gp-bg)]",
                    "[border-color:var(--gp-border)]",
                    "[backdrop-filter:var(--gp-filter)] [-webkit-backdrop-filter:var(--gp-filter)]",
                    "shadow-[var(--gp-shadow)]",
                    "[@media(prefers-reduced-transparency:reduce)]:[background:var(--page-background)]",
                    "[@media(prefers-reduced-transparency:reduce)]:shadow-none",
                    "[@media(prefers-reduced-transparency:reduce)]:[backdrop-filter:none]",
                    "[@media(prefers-reduced-transparency:reduce)]:[-webkit-backdrop-filter:none]",
                    "forced-colors:[background:Canvas] forced-colors:[border-color:CanvasText]",
                    "forced-colors:shadow-none forced-colors:[backdrop-filter:none]",
                    "forced-colors:[-webkit-backdrop-filter:none]",
                    className
                )}
                data-glass-intensity={intensity}
                data-glass-tone={tone}
                // Marker for Wave 3 glass-on-glass collision handling: any
                // overlay surface that opens with a glass ancestor will
                // degrade to opaque so we don't stack frost-on-frost.
                data-glass-context="true"
                ref={ref as React.Ref<HTMLElement>}
                style={{ ...cssVars, ...style }}
                {...rest}
            >
                {children}
            </Comp>
        );
    }
);

GlassPanel.displayName = "GlassPanel";

export default GlassPanel;
