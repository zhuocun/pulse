import { TOUCH_TARGET } from "./touchTarget";

/**
 * Shared assertions for the `ui/*` colocated tests.
 *
 * Tailwind's compiled stylesheet is not loaded in jsdom (CSS imports are
 * mocked), so a primitive's coarse-pointer touch target is verified by the
 * presence of the canonical `TOUCH_TARGET` utility class on the rendered
 * control rather than by reading a computed height. This mirrors the intent
 * of the emotion-era `declares a touch-target height` tests while matching
 * how the Tailwind primitives express the 44px floor.
 */
export const declaresTouchTarget = (element: Element): boolean =>
    element.className.split(/\s+/).includes(TOUCH_TARGET);

export { TOUCH_TARGET };
