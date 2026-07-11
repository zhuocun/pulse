import React from "react";

import { cn } from "@/lib/utils";

import { accent, brand } from "../../theme/tokens";

/**
 * Sanitize a React `useId()` value so it is safe to embed in an SVG
 * element id. Strips the leading colons React emits in development mode
 * (e.g. `:r0:` → `r0`) which are not valid first characters in an HTML
 * id and break `url(#…)` references.
 */
const sanitizeId = (raw: string): string => raw.replace(/[^a-zA-Z0-9_-]/g, "");

interface BrandMarkProps {
    /** When true, renders a larger glyph + wordmark suited for hero / auth surfaces. */
    size?: "sm" | "md" | "lg";
    /** Hide the wordmark and render only the glyph (used when space is tight). */
    glyphOnly?: boolean;
    /** Override the wordmark text. Defaults to the product name. */
    label?: string;
    className?: string;
    style?: React.CSSProperties;
}

const dimensions: Record<
    NonNullable<BrandMarkProps["size"]>,
    {
        glyphClass: string;
        innerSvg: number;
        wordClass: string;
    }
> = {
    sm: { glyphClass: "size-7", innerSvg: 16, wordClass: "text-base" },
    md: { glyphClass: "size-9", innerSvg: 20, wordClass: "text-md" },
    lg: { glyphClass: "size-11", innerSvg: 24, wordClass: "text-lg" }
};

/**
 * Single-source-of-truth brand mark. Replaces the duplicated brand glyph
 * that previously lived inline in `header/index.tsx` and `authLayout.tsx`,
 * so a future brand refresh is one edit. The glyph is rendered as a real
 * SVG (no <img>) so it scales perfectly and inherits text color.
 */
const BrandMark: React.FC<BrandMarkProps> = ({
    size = "sm",
    glyphOnly = false,
    label = "Pulse",
    className,
    style
}) => {
    const { glyphClass, innerSvg, wordClass } = dimensions[size];
    /* Each glyph instance owns its own gradient id so multiple BrandMarks
     * on the same page (e.g. header + auth screen during a transition)
     * don't collide on `url(#…)` references. */
    const gradientId = `brand-pulse-${sanitizeId(React.useId())}`;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-sm font-semibold leading-none tracking-[-0.02em] text-foreground",
                wordClass,
                className
            )}
            style={style}
        >
            <span
                aria-hidden
                className={cn(
                    "inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-card text-brand",
                    "shadow-[0_1px_2px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.6)]",
                    glyphClass
                )}
            >
                <svg
                    focusable="false"
                    height={innerSvg}
                    viewBox="0 0 32 32"
                    width={innerSvg}
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <defs>
                        <linearGradient
                            id={gradientId}
                            x1="0%"
                            y1="0%"
                            x2="100%"
                            y2="100%"
                        >
                            <stop offset="0%" stopColor={accent.end} />
                            <stop offset="100%" stopColor={brand.primary} />
                        </linearGradient>
                    </defs>
                    <path
                        d="M9 10.5 L9 21.5 M14 14.5 L14 17.5 M19 10.5 L19 21.5 M24 14.5 L24 17.5"
                        stroke={`url(#${gradientId})`}
                        strokeLinecap="round"
                        strokeWidth="2.6"
                    />
                </svg>
            </span>
            {glyphOnly ? null : <span>{label}</span>}
        </span>
    );
};

export default BrandMark;
