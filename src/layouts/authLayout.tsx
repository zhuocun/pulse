import {
    BgColorsOutlined,
    DragOutlined,
    ThunderboltOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Card } from "antd";
import { Suspense } from "react";
import { Outlet } from "react-router";

import BrandMark from "../components/brandMark";
import { PageSpin } from "../components/status";
import { microcopy } from "../constants/microcopy";
import {
    aurora,
    bodyCopyCoarseFontCss,
    breakpoints,
    fontSize,
    fontWeight,
    letterSpacing,
    lineHeight,
    radius,
    space
} from "../theme/tokens";

const SkipLink = styled.a`
    /*
     * Unfocused skip links sit above the canvas while translated
     * off-screen; keep pointer-events off until focus so clicks reach
     * real targets. Mirrors the MainLayout skip-link pattern.
     */
    pointer-events: none;
    background: var(--ant-color-primary, #ea580c);
    border-radius: ${radius.md}px;
    color: #fff;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.semibold};
    left: ${space.sm}px;
    padding: ${space.xs}px ${space.md}px;
    position: absolute;
    text-decoration: none;
    top: ${space.sm}px;
    transform: translateY(-200%);
    transition: transform 120ms ease-out;
    z-index: 9999;

    &:focus,
    &:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
        pointer-events: auto;
        transform: translateY(0);
    }

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`;

const Page = styled.div`
    display: grid;
    grid-template-columns: 1fr;
    min-height: 100vh;
    min-height: 100dvh;
    /* Single soft brand-accent glow over the warm page. Uses the
     * palette-derived --aurora-blob so a palette swap re-tints the auth
     * canvas with no edits here. Below the md breakpoint (no hero rail),
     * this glow alone gives the canvas its only colour. */
    background:
        radial-gradient(
            60vmin 50vmin at 50% 30%,
            var(--aurora-blob) 0%,
            transparent 70%
        ),
        var(--pulse-bg-page);

    /*
     * Show the marketing rail on tablet+ instead of waiting for desktop —
     * a 768 × 1024 iPad in portrait has plenty of room to read the hero
     * copy alongside the form. Below "md" the rail collapses so the form
     * gets the full viewport (no wasted space, no awkward 50/50 split).
     */
    @media (min-width: ${breakpoints.md}px) {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

    @media (min-width: ${breakpoints.lg}px) {
        grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    }
`;

/**
 * Marketing rail. Sits on the left at tablet widths and disappears below
 * `md` so the auth card has the full viewport. The visual treatment is a
 * soft indigo gradient with a subtle dot pattern overlay — no heavy
 * decorative SVGs, no raster images, just CSS so it scales perfectly.
 */
const HeroRail = styled.aside`
    display: none;

    @media (min-width: ${breakpoints.md}px) {
        align-items: center;
        /* Single deep brand-accent glow over the cinematic base — a
         * smooth vignette rather than a multi-color mesh. Uses
         * aurora.mid (palette-derived) so the whole rail follows the
         * active palette without any edits to this file. */
        background:
            radial-gradient(
                70vmin 60vmin at 30% 30%,
                ${aurora.mid} 0%,
                transparent 70%
            ),
            ${aurora.cinematicBase};
        color: #fff;
        display: flex;
        justify-content: center;
        padding: ${space.xxl}px ${space.xl}px;
        position: relative;
    }

    @media (min-width: ${breakpoints.lg}px) {
        padding: ${space.xxxl}px ${space.xxl}px;
    }

    /* Subtle grid texture so the gradient does not feel empty. */
    &::before {
        content: "";
        position: absolute;
        inset: 0;
        background-image:
            linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
            linear-gradient(
                90deg,
                rgba(255, 255, 255, 0.04) 1px,
                transparent 1px
            );
        background-size: 32px 32px;
        mask-image: radial-gradient(closest-side, black 0%, transparent 100%);
        pointer-events: none;
    }
`;

const HeroInner = styled.div`
    max-width: 32rem;
    position: relative;
    z-index: 1;
    text-align: left;
`;

const HeroBadge = styled.div`
    align-items: center;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: ${radius.pill}px;
    color: rgba(255, 255, 255, 0.9);
    display: inline-flex;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.medium};
    gap: ${space.xs}px;
    padding: ${space.xxs}px ${space.sm}px;
`;

const HeroBadgeDot = styled.span`
    /* Light brand-accent dot — sits inside a single-hue identity,
     * glowing brightly against the deep cinematic base. The dot color
     * follows the active palette automatically. */
    background: ${aurora.light};
    border-radius: 50%;
    box-shadow:
        0 0 10px ${aurora.light},
        0 0 20px var(--aurora-blob-strong);
    display: inline-block;
    height: 6px;
    width: 6px;
`;

const HeroTitle = styled.h2`
    color: #fff;
    /* xxl (28 px) on tablet, display (36 px) on desktop. The smaller value
     * keeps the headline within the rail's available width on a portrait
     * iPad without overflowing the rail's left padding. */
    font-size: ${fontSize.xxl}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: ${letterSpacing.tight};
    line-height: ${lineHeight.tight};
    margin: ${space.lg}px 0 ${space.md}px;

    @media (min-width: ${breakpoints.lg}px) {
        font-size: ${fontSize.display}px;
    }
`;

const HeroSubtitle = styled.p`
    color: rgba(255, 255, 255, 0.72);
    font-size: ${fontSize.md}px;
    line-height: ${lineHeight.relaxed};
    margin: 0 0 ${space.xl}px;
    max-width: 28rem;
`;

const HeroFeatureList = styled.ul`
    display: grid;
    gap: ${space.md}px;
    list-style: none;
    margin: 0;
    padding: 0;
`;

const HeroFeature = styled.li`
    align-items: center;
    color: rgba(255, 255, 255, 0.92);
    display: flex;
    font-size: ${fontSize.base}px;
    gap: ${space.sm}px;
`;

const HeroFeatureIcon = styled.span`
    align-items: center;
    background: linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.16) 0%,
        rgba(255, 255, 255, 0.06) 100%
    );
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: ${radius.md}px;
    color: #fff;
    display: inline-flex;
    flex: 0 0 auto;
    font-size: 16px;
    height: 36px;
    justify-content: center;
    width: 36px;

    svg {
        height: 18px;
        width: 18px;
    }
`;

const HeroFinePrint = styled.p`
    color: rgba(255, 255, 255, 0.6);
    ${bodyCopyCoarseFontCss}
    line-height: ${lineHeight.normal};
    margin: ${space.xl}px 0 0;
`;

/**
 * Main auth canvas. Holds the brand mark and the form card.
 *
 * Rendered as a real `<main>` landmark so keyboard / screen-reader users
 * can jump straight to the form via the standard "main content" pattern
 * (WCAG 2.4.1 Bypass Blocks). The previous `<div>` left auth pages
 * without any top-level landmark.
 */
const Canvas = styled.main`
    align-items: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: ${space.md}px;
    padding-block-start: max(${space.lg}px, env(safe-area-inset-top));
    padding-block-end: max(${space.md}px, env(safe-area-inset-bottom));
    padding-inline-start: max(${space.md}px, env(safe-area-inset-left));
    padding-inline-end: max(${space.md}px, env(safe-area-inset-right));
    width: 100%;

    @media (min-width: ${breakpoints.sm}px) {
        padding: ${space.lg}px;
        padding-block-start: max(${space.xl}px, env(safe-area-inset-top));
        padding-block-end: max(${space.lg}px, env(safe-area-inset-bottom));
        padding-inline-start: max(${space.lg}px, env(safe-area-inset-left));
        padding-inline-end: max(${space.lg}px, env(safe-area-inset-right));
    }
`;

const BrandHeader = styled.header`
    align-items: center;
    display: inline-flex;
    margin-bottom: ${space.xl}px;
`;

/**
 * Page-level heading for auth screens. Rendered as an `h1` for correct
 * document outline (login/register are top-level pages); we override
 * AntD typography here for closer kerning and a heavier weight.
 */
export const AuthTitle = styled.h1`
    color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
    font-size: ${fontSize.lg}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: ${letterSpacing.tight};
    line-height: ${lineHeight.snug};
    margin: 0 0 ${space.xxs}px;
    text-align: left;

    @media (min-width: ${breakpoints.sm}px) {
        font-size: ${fontSize.xl}px;
    }
`;

/**
 * Subhead under the auth title. Optional — pages that don't render one
 * still have AuthTitle take the full available height.
 */
export const AuthSubtitle = styled.p`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    font-size: ${fontSize.base}px;
    line-height: ${lineHeight.normal};
    margin: 0 0 ${space.lg}px;
    text-align: left;
`;

/**
 * AntD `Card` is retained as the form shell so the existing test contract
 * (`.ant-card` selector) keeps passing while we deliver a refined surface
 * treatment via the `box-shadow` / `border` / `border-radius` overrides.
 */
const FormCard = styled(Card)`
    && {
        /* Glass form pane sitting on the soft emerald glow — strong
         * surface + heavy blur + a neutral drop shadow. Letting the
         * shadow stay slate (instead of emerald) keeps the form pane
         * reading as crisp white rather than tinted; the emerald only
         * appears as a 1 px hairline at the border. */
        background: var(--glass-surface-strong);
        /* Wave 2 T4 — consume the STRONG intensity-toggle var. The
         * auth form card is the brand-first-impression surface;
         * preserves the original 28 px showpiece blur at default
         * intensity while still scaling under "clear" (down to 20 px)
         * and "solid" (none). Three-var system reconciles parity with
         * the user-facing toggle. */
        backdrop-filter: var(--ant-backdrop-filter-glass-strong);
        -webkit-backdrop-filter: var(--ant-backdrop-filter-glass-strong);
        border: 1px solid var(--glass-border-strong);
        border-radius: ${radius.lg}px;
        box-shadow:
            0 24px 48px -12px rgba(15, 23, 42, 0.18),
            var(--glass-shine);
        box-sizing: border-box;
        max-width: 40rem;
        text-align: left;
        width: min(40rem, 100% - 2rem);
        /*
         * Phase 5 "Liquid Glass" Wave 2 — relative positioning so the
         * ::before / ::after specular rim layers anchor to the card's
         * box. AntD Card defaults to static positioning, so we promote
         * it here.
         */
        position: relative;
    }

    /*
     * Phase 5 "Liquid Glass" Wave 2 — showpiece specular rim. The
     * auth form is the strongest glass surface in the app (strong
     * surface, heavy blur, brand-tinted border) so it gets the
     * loudest rim via the --glass-rim-strong / white-at-0.48
     * highlight stop in --glass-specular-top. The diagonal axis
     * sits the highlight on the top-leading corner and the
     * companion shadow on the bottom-trailing, modelling a tilted
     * achromatic light catching the edge of the card.
     */
    && {
        &::before {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: inherit;
            background: var(--glass-specular-top);
            pointer-events: none;
            z-index: 0;
        }

        &::after {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: inherit;
            background: var(--glass-specular-bottom);
            pointer-events: none;
            z-index: 0;
        }
    }

    /* Children (the AntD card body) sit above the rim pseudo-elements. */
    && .ant-card-body {
        padding: ${space.lg}px;
        position: relative;
        z-index: 1;

        @media (min-width: ${breakpoints.sm}px) {
            padding: ${space.xxl}px;
        }
    }

    /*
     * Honour the user's reduced-transparency preference and Windows
     * forced-colors mode: drop the rim layers so they don't paint
     * achromatic gradients over an opaque body or compete with the
     * system colour tokens.
     */
    @media (prefers-reduced-transparency: reduce) {
        && {
            &::before,
            &::after {
                background: none;
            }
        }
    }

    @media (forced-colors: active) {
        && {
            &::before,
            &::after {
                background: none;
            }
        }
    }
`;

/**
 * Auth submit button. Full width on mobile (single dominant CTA),
 * with the same minimum height for predictable alignment with the
 * rest of the form.
 */
export const AuthButton = styled(Button)`
    && {
        font-weight: 500;
        height: 44px;
        width: 100%;
        /*
         * Phase 5 "Liquid Glass" Wave 2 — gel-flex on the dominant
         * submit CTA. The shorthand REPLACES AntD's transition:all
         * so we re-enumerate the colour / bg / border / box-shadow
         * channels AntD animates (100 ms cadence) and stack the
         * spring-timed transform on top. transform-only so the 44 px
         * hit target is preserved.
         */
        transition:
            color 100ms ease-in-out,
            background 100ms ease-in-out,
            border-color 100ms ease-in-out,
            box-shadow 100ms ease-in-out,
            transform var(--motion-gel-flex, 220ms)
                var(--easing-spring-snap, ease-out);
        will-change: transform;
    }

    &&:active {
        transform: scale(0.97);
    }

    @media (prefers-reduced-motion: reduce) {
        && {
            transition: none;
        }

        &&:active {
            transform: none;
        }
    }
`;

const AuthLayout = () => {
    return (
        <Page>
            <SkipLink href="#auth-main">
                {microcopy.a11y.skipToMainContent}
            </SkipLink>
            <HeroRail aria-hidden="true">
                <HeroInner>
                    <HeroBadge>
                        <HeroBadgeDot />
                        {microcopy.auth.heroBadge}
                    </HeroBadge>
                    <HeroTitle>{microcopy.auth.heroTitle}</HeroTitle>
                    <HeroSubtitle>{microcopy.auth.heroSubtitle}</HeroSubtitle>
                    <HeroFeatureList>
                        <HeroFeature>
                            <HeroFeatureIcon aria-hidden>
                                <ThunderboltOutlined />
                            </HeroFeatureIcon>
                            {microcopy.auth.heroFeatureDraft}
                        </HeroFeature>
                        <HeroFeature>
                            <HeroFeatureIcon aria-hidden>
                                <DragOutlined />
                            </HeroFeatureIcon>
                            {microcopy.auth.heroFeatureDrag}
                        </HeroFeature>
                        <HeroFeature>
                            <HeroFeatureIcon aria-hidden>
                                <BgColorsOutlined />
                            </HeroFeatureIcon>
                            {microcopy.auth.heroFeatureColors}
                        </HeroFeature>
                    </HeroFeatureList>
                    <HeroFinePrint>
                        {microcopy.auth.heroFinePrint}
                    </HeroFinePrint>
                </HeroInner>
            </HeroRail>
            <Canvas id="auth-main" tabIndex={-1}>
                <BrandHeader>
                    <BrandMark size="md" />
                </BrandHeader>
                <FormCard data-glass-context="true">
                    {/* Suspense lives inside the layout so the brand
                     * chrome stays mounted while a lazy page chunk
                     * fetches. */}
                    <Suspense fallback={<PageSpin />}>
                        <Outlet />
                    </Suspense>
                </FormCard>
            </Canvas>
        </Page>
    );
};

export default AuthLayout;
