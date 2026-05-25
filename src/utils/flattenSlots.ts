import React from "react";

/*
 * Flatten React fragments (and arrays) to leaf nodes so callers can pass
 * conditionally-gated children inside fragments — e.g.
 * `<>{cond && <A/>}<B/></>` — and still get ONE slot (one separator
 * boundary) per leaf control. `React.Children.toArray` strips falsy
 * entries and assigns keys but does NOT descend into fragments, so a
 * fragment-wrapped child set would otherwise collapse into a single slot
 * and paint no dividers.
 */
export const flattenSlots = (children: React.ReactNode): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    React.Children.toArray(children).forEach((node) => {
        if (React.isValidElement(node) && node.type === React.Fragment) {
            const fragmentChildren = (
                node as React.ReactElement<{ children?: React.ReactNode }>
            ).props.children;
            out.push(...flattenSlots(fragmentChildren));
        } else {
            out.push(node);
        }
    });
    return out;
};
