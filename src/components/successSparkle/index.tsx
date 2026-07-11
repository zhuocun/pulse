import React from "react";

import { accent, easing, motion } from "../../theme/tokens";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

/**
 * SuccessSparkle — Phase 6 Wave 8.
 *
 * A brief, tasteful particle burst that fires once when an action succeeds
 * (currently: an AI mutation proposal reaching its committed phase — see
 * `mutationProposalCard`). A handful of small dots scale up, translate
 * radially outward from the centre, and fade over roughly `motion.medium`.
 * Pure CSS keyframes (a scoped `<style>` block) — NO confetti dependency.
 *
 * Decorative-only contract: the burst conveys NO information a screen
 * reader needs (the accept flow already owns its own status / ledger
 * announcement), so the overlay is `aria-hidden` and `pointer-events:
 * none` — it never traps focus, never announces, and never intercepts a
 * click on the card beneath it.
 *
 * Reduced-motion (WCAG 2.3.3): when `useReducedMotion()` is true we render
 * NOTHING at all. There is no static "end state" to show — a finished
 * burst is just empty space — so the cleanest reduced-motion behaviour is
 * to omit the effect entirely. The haptic + ledger entry that accompany
 * the accept are the non-motion confirmation channels.
 */

/** Number of sparkle dots in the burst. A handful — tasteful, not spam. */
const PARTICLE_COUNT = 8;

interface ParticleVector {
    x: number;
    y: number;
}

const PARTICLE_VECTORS: readonly ParticleVector[] = [
    { x: 0, y: -22 },
    { x: 16, y: -16 },
    { x: 22, y: 0 },
    { x: 16, y: 16 },
    { x: 0, y: 22 },
    { x: -16, y: 16 },
    { x: -22, y: 0 },
    { x: -16, y: -16 }
];

/*
 * The burst keyframes. The dot starts at the centre, invisible and small,
 * pops to full size + opacity early, then drifts out to its vector while
 * fading to nothing. `--sx` / `--sy` are the per-particle CSS custom
 * properties supplying the radial vector so a single keyframes block
 * drives every dot (each one just sets its own end offset).
 */
const SPARKLE_KEYFRAMES = `
@keyframes pulse-sparkle-burst {
    0% {
        opacity: 0;
        transform: translate(-50%, -50%) translate(0, 0) scale(0.2);
    }
    30% {
        opacity: 1;
        transform: translate(-50%, -50%)
            translate(calc(var(--sx) * 0.4), calc(var(--sy) * 0.4)) scale(1);
    }
    100% {
        opacity: 0;
        transform: translate(-50%, -50%)
            translate(var(--sx), var(--sy)) scale(0.6);
    }
}`;

export interface SuccessSparkleProps {
    /**
     * Root testid. Present only when the burst actually renders (i.e.
     * motion is enabled) so a test can assert presence/absence cleanly.
     */
    "data-testid"?: string;
}

/**
 * Decorative success particle burst. Renders nothing under
 * `prefers-reduced-motion: reduce`; otherwise paints a one-shot CSS burst
 * over its positioned parent. Mount it at the success moment and let it
 * play — it carries no completion callback because the host owns the
 * lifecycle (e.g. the card mounts it in its `committed` render).
 */
const SuccessSparkle: React.FC<SuccessSparkleProps> = ({
    "data-testid": dataTestid
}) => {
    const reducedMotion = useReducedMotion();
    if (reducedMotion) return null;
    return (
        <>
            <style>{SPARKLE_KEYFRAMES}</style>
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-[1] overflow-visible"
                data-testid={dataTestid}
            >
                {PARTICLE_VECTORS.slice(0, PARTICLE_COUNT).map(
                    (vector, index) => (
                        // Particle wrappers are positional decoration around a
                        // stable, ordered set; the index is the right identity.
                        <span
                            key={index}
                            className="absolute left-1/2 top-1/2 size-[6px] rounded-full"
                            style={
                                {
                                    "--sx": `${vector.x}px`,
                                    "--sy": `${vector.y}px`,
                                    animation: `pulse-sparkle-burst ${motion.medium}ms ${easing.decelerate} forwards`,
                                    backgroundImage: `linear-gradient(135deg, ${accent.start}, ${accent.end})`
                                } as React.CSSProperties
                            }
                        />
                    )
                )}
            </div>
        </>
    );
};

export default SuccessSparkle;
