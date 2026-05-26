import { keyframes } from "@emotion/react";
import styled from "@emotion/styled";
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
 * Pure CSS keyframes via Emotion `styled` — NO confetti dependency.
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

/**
 * Per-particle radial vector. Each dot translates from the centre out to
 * its `(x, y)` offset (px) while scaling up and fading. Eight evenly-ish
 * distributed directions read as a symmetric little pop without looking
 * mechanically radial.
 */
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
const burst = keyframes`
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
`;

/**
 * The overlay. Absolutely positioned, centred over the host (the host
 * MUST establish a positioning context — the card's `Wrap` is
 * `position: relative` for exactly this). Sits above the card content but
 * lets clicks fall through.
 */
const Overlay = styled.div`
    inset: 0;
    overflow: visible;
    pointer-events: none;
    position: absolute;
    z-index: 1;
`;

interface ParticleProps {
    $vector: ParticleVector;
}

/**
 * A single sparkle dot. Anchored at the centre of the overlay; the
 * keyframes translate it out from there. The accent gradient ties the
 * burst to the AI surface palette (same hue family as `aiSparkleIcon`).
 */
const Particle = styled.span<ParticleProps>`
    --sx: ${(p) => p.$vector.x}px;
    --sy: ${(p) => p.$vector.y}px;
    animation: ${burst} ${motion.medium}ms ${easing.decelerate} forwards;
    background: linear-gradient(135deg, ${accent.start}, ${accent.end});
    border-radius: 50%;
    height: 6px;
    left: 50%;
    position: absolute;
    top: 50%;
    width: 6px;
`;

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
        <Overlay aria-hidden data-testid={dataTestid}>
            {Array.from({ length: PARTICLE_COUNT }).map((_, index) => (
                <Particle $vector={PARTICLE_VECTORS[index]} key={index} />
            ))}
        </Overlay>
    );
};

export default SuccessSparkle;
