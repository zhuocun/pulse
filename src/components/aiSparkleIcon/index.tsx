import React, { useId } from "react";

import { sparkleSize, type SparkleSize } from "../../theme/aiTokens";

/**
 * AI accent sparkle. Renders a violet→indigo→pink gradient that visually
 * separates AI surfaces from the rest of the brand.
 *
 * SSR safety (PRD v3 S-R1): the gradient id is sourced from React's
 * `useId()` so multiple instances on the same page don't collide and
 * server-rendered output matches the hydrated DOM. The previous
 * module-level counter crashed on SSR and produced duplicate IDs after
 * Vite HMR.
 *
 * Theming (S-R2): each gradient stop binds to a CSS custom property
 * (`--color-copilot-grad-*`) declared in `App.css` and resolved per
 * palette via `cssVars.ts`. The raw orange literals used to live as
 * inline `stopColor` fallbacks; we removed them so that on a non-orange
 * palette (or before the CSS variables hydrate) the gradient does not
 * flash brand orange for a frame. Browsers fall back to `currentColor`
 * for unresolved `<stop>` colors, which inherits cleanly from the
 * surrounding label.
 *
 * Accessibility (S-R3, S-R4): the props form a discriminated union —
 * either `aria-hidden` is `true` (decorative; SVG contributes nothing to
 * the AX tree) or the caller supplies an explicit `aria-label` (image
 * with that accessible name). There is no longer a hidden default of
 * "Board Copilot" that leaks into surrounding labeled controls.
 */
type SparkleBaseProps = {
    /**
     * Optional sizing token. `sm` ≈ 14 px, `md` ≈ 18 px, `lg` ≈ 24 px.
     * Without this prop the icon scales to the surrounding font (`1em`).
     */
    size?: SparkleSize;
    style?: React.CSSProperties;
};

type SparkleDecorativeProps = SparkleBaseProps & {
    /**
     * Marks the icon as decorative. The SVG is rendered with
     * `aria-hidden="true"` and contributes no accessible name. Use this
     * variant whenever the parent control (Button, link, drawer header)
     * already carries the accessible name.
     */
    "aria-hidden": true;
    "aria-label"?: never;
};

type SparkleLabeledProps = SparkleBaseProps & {
    /**
     * Accessible name for standalone interactive icons. Required when
     * `aria-hidden` is not set so a screen reader hears a meaningful
     * label instead of "graphic".
     */
    "aria-label": string;
    "aria-hidden"?: false;
};

type AiSparkleIconProps = SparkleDecorativeProps | SparkleLabeledProps;

const AiSparkleIcon: React.FC<AiSparkleIconProps> = (props) => {
    const id = useId();
    const { size, style } = props;
    const dim = size ? sparkleSize[size] : undefined;
    const sizeProps =
        dim !== undefined
            ? { height: dim, width: dim }
            : { height: "1em", width: "1em" };
    const baseStyle: React.CSSProperties = {
        verticalAlign: "-0.125em",
        ...style
    };
    const isDecorative = props["aria-hidden"] === true;
    if (isDecorative) {
        return (
            <svg
                aria-hidden="true"
                fill="none"
                focusable="false"
                style={baseStyle}
                viewBox="0 0 24 24"
                {...sizeProps}
            >
                <defs>
                    <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop
                            offset="0%"
                            stopColor="var(--color-copilot-grad-start)"
                        />
                        <stop
                            offset="60%"
                            stopColor="var(--color-copilot-grad-mid)"
                        />
                        <stop
                            offset="100%"
                            stopColor="var(--color-copilot-grad-end)"
                        />
                    </linearGradient>
                </defs>
                <path
                    d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4L12 3z"
                    fill={`url(#${id})`}
                />
                <path
                    d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"
                    fill={`url(#${id})`}
                    opacity="0.7"
                />
            </svg>
        );
    }
    return (
        <svg
            aria-label={props["aria-label"]}
            fill="none"
            role="img"
            style={baseStyle}
            viewBox="0 0 24 24"
            {...sizeProps}
        >
            <defs>
                <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop
                        offset="0%"
                        stopColor="var(--color-copilot-grad-start)"
                    />
                    <stop
                        offset="60%"
                        stopColor="var(--color-copilot-grad-mid)"
                    />
                    <stop
                        offset="100%"
                        stopColor="var(--color-copilot-grad-end)"
                    />
                </linearGradient>
            </defs>
            <path
                d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4L12 3z"
                fill={`url(#${id})`}
            />
            <path
                d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"
                fill={`url(#${id})`}
                opacity="0.7"
            />
        </svg>
    );
};

export default AiSparkleIcon;
