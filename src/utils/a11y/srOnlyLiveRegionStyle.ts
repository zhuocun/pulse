/**
 * Screen-reader-only live regions need pointer-events disabled because the
 * clipped 1x1 box can still intercept clicks on controls layered behind it.
 */
export const srOnlyLiveRegionStyle = {
    border: 0,
    clip: "rect(0 0 0 0)",
    height: 1,
    margin: -1,
    overflow: "hidden",
    padding: 0,
    pointerEvents: "none" as const,
    position: "absolute" as const,
    width: 1
};
