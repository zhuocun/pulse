/**
 * Visually-hidden ARIA live region.
 *
 * Wraps `children` in a screen-reader-only container that announces
 * updates politely (or assertively) without taking layout space or
 * intercepting pointer events. Promotes the inline
 * `srOnlyLiveRegionStyle` pattern (clip / 1×1 / position absolute) to a
 * single reusable component so every announcer in the app shares the
 * same visually-hidden contract.
 *
 * Live regions need pointer-events disabled because the clipped 1x1 box
 * can still intercept clicks on controls layered behind it.
 */
import type { ReactNode } from "react";

import { srOnlyLiveRegionStyle } from "./srOnlyLiveRegionStyle";

interface SrOnlyLiveProps {
    /**
     * `polite` (default) waits for the AT to finish current output;
     * `assertive` interrupts. Reserve `assertive` for genuinely critical
     * announcements — most status text should remain `polite`.
     */
    "aria-live"?: "polite" | "assertive";
    /**
     * Defaults to `status` so the live region maps to the
     * platform-standard "status" role; pass `alert` for assertive
     * announcements that should pre-empt other output.
     */
    role?: "status" | "alert";
    /**
     * When `true` (default), each update is announced as a complete
     * replacement rather than a diff. Matches the existing inline
     * pattern used by `aiTaskAssistPanel`, `boardBriefDrawer`, etc.
     */
    "aria-atomic"?: boolean;
    children?: ReactNode;
}

const SrOnlyLive = ({
    "aria-live": ariaLive = "polite",
    "aria-atomic": ariaAtomic = true,
    role = "status",
    children
}: SrOnlyLiveProps) => (
    <div
        aria-atomic={ariaAtomic}
        aria-live={ariaLive}
        role={role}
        style={srOnlyLiveRegionStyle}
    >
        {children}
    </div>
);

export default SrOnlyLive;
