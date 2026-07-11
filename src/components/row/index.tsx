import React from "react";

import { cn } from "@/lib/utils";

/**
 * Lightweight horizontal flex row used by headers and toolbars.
 *
 * `gap` mirrors the original API: `gap={true}` applies a `2rem` gap,
 * `gap={n}` applies `n` rem, and unset disables the gap. The gap is
 * emitted as a right margin on every child, and each child's vertical
 * margins are zeroed so mixed content lines up on the row's baseline.
 *
 * `marginBottom` is in rems and is only emitted when defined, so unset
 * callers do not produce an invalid `margin-bottom` value.
 */
interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
    gap?: number | boolean;
    between?: boolean;
    marginBottom?: number;
}

const Row: React.FC<RowProps> = ({
    gap,
    between,
    marginBottom,
    className,
    style,
    children,
    ...props
}) => {
    const marginRight =
        typeof gap === "number" ? `${gap}rem` : gap ? "2rem" : undefined;
    return (
        <div
            className={cn(
                "flex items-center",
                between && "justify-between",
                className
            )}
            style={{
                ...(typeof marginBottom === "number"
                    ? { marginBottom: `${marginBottom}rem` }
                    : {}),
                ...style
            }}
            {...props}
        >
            {React.Children.map(children, (child) =>
                React.isValidElement(child)
                    ? React.cloneElement(
                          child as React.ReactElement<{
                              style?: React.CSSProperties;
                          }>,
                          {
                              style: {
                                  ...(
                                      child as React.ReactElement<{
                                          style?: React.CSSProperties;
                                      }>
                                  ).props.style,
                                  marginTop: 0,
                                  marginBottom: 0,
                                  marginRight
                              }
                          }
                      )
                    : child
            )}
        </div>
    );
};

export default Row;
