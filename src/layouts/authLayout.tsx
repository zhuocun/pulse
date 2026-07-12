import { Move, Palette, Zap } from "lucide-react";
import { forwardRef, type HTMLAttributes, Suspense } from "react";
import { Outlet } from "react-router";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import BrandMark from "../components/brandMark";
import { PageSpin } from "../components/status";
import { microcopy } from "../constants/microcopy";

/*
 * Unfocused skip links sit above the canvas while translated off-screen;
 * pointer-events stay off until focus so clicks reach real targets. Mirrors
 * the MainLayout skip-link pattern.
 */
const SKIP_LINK_CLASS = cn(
    "pointer-events-none absolute left-sm top-sm z-[9999]",
    "rounded-md bg-brand px-md py-xs text-sm font-semibold text-white no-underline",
    "-translate-y-[200%] transition-transform duration-short ease-out",
    "focus:pointer-events-auto focus:translate-y-0",
    "focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-white",
    "focus-visible:pointer-events-auto focus-visible:translate-y-0",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
    "motion-reduce:transition-none"
);

/*
 * A single soft brand-accent glow over the warm page. The `--aurora-blob` and
 * `--pulse-bg-page` vars are palette-derived, so a palette swap re-tints the
 * auth canvas with no edits here. Below md (no hero rail) this glow alone gives
 * the canvas its colour. The responsive columns show the marketing rail from
 * tablet up (token breakpoints md=768, lg=1024).
 */
const PAGE_CLASS = cn(
    "grid min-h-screen min-h-[100dvh] grid-cols-1",
    "[background:radial-gradient(60vmin_50vmin_at_50%_30%,var(--aurora-blob)_0%,transparent_70%),var(--pulse-bg-page)]",
    "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
    "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]"
);

/*
 * Marketing rail. Hidden below md so the auth card owns the viewport; from md
 * it is a deep single-hue aurora vignette (palette-derived `--pulse-aurora-*`)
 * with a subtle grid texture painted by the ::before layer.
 */
const HERO_RAIL_CLASS = cn(
    "hidden",
    "md:relative md:flex md:items-center md:justify-center md:px-xl md:py-xxl md:text-white",
    "md:[background:radial-gradient(70vmin_60vmin_at_30%_30%,var(--pulse-aurora-mid)_0%,transparent_70%),var(--pulse-aurora-cinematic-base)]",
    "lg:px-xxl lg:py-xxxl",
    "before:pointer-events-none before:absolute before:inset-0 before:content-['']",
    "before:[background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)]",
    "before:[background-size:32px_32px]",
    "before:[mask-image:radial-gradient(closest-side,black_0%,transparent_100%)]"
);

const HERO_INNER_CLASS = "relative z-[1] max-w-[32rem] text-left";

const HERO_BADGE_CLASS = cn(
    "inline-flex items-center gap-xs rounded-pill",
    "border border-white/[0.16] bg-white/[0.08] px-sm py-xxs",
    "text-sm font-medium text-white/90"
);

/* Light brand-accent dot glowing against the deep base; follows the palette. */
const HERO_BADGE_DOT_CLASS = cn(
    "inline-block h-[6px] w-[6px] rounded-full",
    "[background:var(--pulse-aurora-light)]",
    "[box-shadow:0_0_10px_var(--pulse-aurora-light),0_0_20px_var(--aurora-blob-strong)]"
);

const HERO_TITLE_CLASS = cn(
    "m-0 mt-lg mb-md text-white",
    "text-xxl font-semibold leading-tight tracking-[-0.02em]",
    "lg:text-display"
);

const HERO_SUBTITLE_CLASS =
    "m-0 mb-xl max-w-[28rem] text-md leading-relaxed text-white/[0.72]";

const HERO_FEATURE_LIST_CLASS = "m-0 grid list-none gap-md p-0";

const HERO_FEATURE_CLASS =
    "flex items-center gap-sm text-base text-white/[0.92]";

const HERO_FEATURE_ICON_CLASS = cn(
    "inline-flex size-9 flex-[0_0_auto] items-center justify-center rounded-md",
    "border border-white/[0.18] text-white",
    "[background:linear-gradient(135deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.06)_100%)]",
    "[&_svg]:size-[18px]"
);

const HERO_FINE_PRINT_CLASS =
    "m-0 mt-xl text-sm leading-normal text-white/[0.6] coarse:text-base";

/*
 * Main auth canvas — a real `<main>` landmark so keyboard / screen-reader
 * users can jump straight to the form (WCAG 2.4.1 Bypass Blocks). Padding
 * respects the safe-area insets and steps up past the 480px token breakpoint.
 */
const CANVAS_CLASS = cn(
    "flex w-full flex-col items-center justify-center",
    "[padding-block-start:max(24px,env(safe-area-inset-top))]",
    "[padding-block-end:max(16px,env(safe-area-inset-bottom))]",
    "[padding-inline-start:max(16px,env(safe-area-inset-left))]",
    "[padding-inline-end:max(16px,env(safe-area-inset-right))]",
    "min-[480px]:[padding-block-start:max(32px,env(safe-area-inset-top))]",
    "min-[480px]:[padding-block-end:max(24px,env(safe-area-inset-bottom))]",
    "min-[480px]:[padding-inline-start:max(24px,env(safe-area-inset-left))]",
    "min-[480px]:[padding-inline-end:max(24px,env(safe-area-inset-right))]"
);

const BRAND_HEADER_CLASS = "mb-xl inline-flex items-center";

/*
 * Page-level heading for auth screens. An `h1` for correct document outline
 * (login/register are top-level pages), with closer kerning and a heavier
 * weight than the primitive typography.
 */
const AUTH_TITLE_CLASS = cn(
    "m-0 mb-xxs text-left text-page-text",
    "text-lg font-semibold leading-snug tracking-[-0.02em]",
    "min-[480px]:text-xl"
);

const AUTH_SUBTITLE_CLASS = cn(
    "m-0 mb-lg text-left text-base leading-normal",
    "[color:var(--pulse-text-secondary,rgba(15,23,42,0.65))]"
);

/*
 * Form shell built on the `Card` primitive. The showpiece glass treatment
 * (strong surface, brand-tinted hairline, specular rims) overrides the card
 * defaults. The `data-glass-context` marker lets App.css collapse the surface
 * to opaque under the user's "Solid" intensity choice; the reduced-transparency
 * and forced-colors utilities below drop the rims + blur for those modes.
 *
 * The blur is a literal `blur(28px) saturate(180%)` (the STRONG-regular recipe)
 * rather than the `--pulse-backdrop-filter-glass-strong` intensity lever, so
 * the auth showpiece keeps its fixed strong blur independent of the global
 * glass-intensity toggle.
 */
const FORM_CARD_CLASS = cn(
    "relative w-[min(40rem,100%-2rem)] max-w-[40rem] rounded-lg text-left",
    "bg-[var(--glass-surface-strong)]",
    "border-[color:var(--glass-border-strong)]",
    "shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18),var(--glass-shine)]",
    "[backdrop-filter:blur(28px)_saturate(180%)] [-webkit-backdrop-filter:blur(28px)_saturate(180%)]",
    "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[inherit] before:content-[''] before:[background:var(--glass-specular-top)]",
    "after:pointer-events-none after:absolute after:inset-0 after:z-0 after:rounded-[inherit] after:content-[''] after:[background:var(--glass-specular-bottom)]",
    "[@media(prefers-reduced-transparency:reduce)]:[backdrop-filter:none] [@media(prefers-reduced-transparency:reduce)]:[-webkit-backdrop-filter:none]",
    "[@media(prefers-reduced-transparency:reduce)]:before:[background:none] [@media(prefers-reduced-transparency:reduce)]:after:[background:none]",
    "forced-colors:bg-[Canvas] forced-colors:[backdrop-filter:none] forced-colors:[-webkit-backdrop-filter:none]",
    "forced-colors:before:[background:none] forced-colors:after:[background:none]"
);

/* Owns the padding the antd card body supplied; sits above the rim layers. */
const FORM_CARD_BODY_CLASS = "relative z-[1] p-lg min-[480px]:p-xxl";

/*
 * Auth submit button. Full width (single dominant CTA) with a 44px height for
 * predictable alignment and a coarse-safe hit target. The gel-flex press
 * transform re-enumerates the colour channels so it can layer the spring-timed
 * transform without clobbering them; transform-only keeps the hit area intact.
 */
const AUTH_BUTTON_CLASS = cn(
    "h-11 w-full font-medium will-change-transform",
    "[transition:color_100ms_ease-in-out,background_100ms_ease-in-out,border-color_100ms_ease-in-out,box-shadow_100ms_ease-in-out,transform_var(--motion-gel-flex,220ms)_var(--easing-spring-snap,ease-out)]",
    "active:scale-[0.97]",
    "motion-reduce:[transition:none] motion-reduce:active:scale-100"
);

/**
 * Page-level auth heading (`h1`). Exported for the login/register/forgot/terms
 * pages that compose it above their forms.
 */
export const AuthTitle = ({
    children,
    className,
    ...props
}: HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className={cn(AUTH_TITLE_CLASS, className)} {...props}>
        {children}
    </h1>
);

/**
 * Subhead under the auth title. Optional — pages that omit it still have the
 * title take the full available height.
 */
export const AuthSubtitle = ({
    className,
    ...props
}: HTMLAttributes<HTMLParagraphElement>) => (
    <p className={cn(AUTH_SUBTITLE_CLASS, className)} {...props} />
);

/*
 * Antd-compatible `Button` adapter. The auth forms still hand this the antd
 * `type` / `htmlType` prop shape, so map those onto the primitive `Button`'s
 * `variant` / native `type`. Defaults to the primary variant — the dominant CTA.
 */
const ANTD_TYPE_TO_VARIANT: Record<
    NonNullable<AuthButtonBaseProps["type"]>,
    ButtonProps["variant"]
> = {
    primary: "primary",
    default: "default",
    link: "link",
    text: "ghost",
    dashed: "outline",
    ghost: "outline"
};

interface AuthButtonBaseProps extends Omit<ButtonProps, "type"> {
    type?: "primary" | "default" | "link" | "text" | "dashed" | "ghost";
    htmlType?: "button" | "submit" | "reset";
}

const AuthButtonBase = forwardRef<HTMLButtonElement, AuthButtonBaseProps>(
    ({ type = "primary", htmlType, variant, ...props }, ref) => (
        <Button
            ref={ref}
            type={htmlType}
            variant={variant ?? ANTD_TYPE_TO_VARIANT[type]}
            {...props}
        />
    )
);
AuthButtonBase.displayName = "AuthButtonBase";

/**
 * Auth submit button. Exported for the login/register forms, which drive it
 * with the antd `htmlType` / `loading` prop shape.
 */
export const AuthButton = forwardRef<HTMLButtonElement, AuthButtonBaseProps>(
    ({ className, ...props }, ref) => (
        <AuthButtonBase
            ref={ref}
            className={cn(AUTH_BUTTON_CLASS, className)}
            {...props}
        />
    )
);
AuthButton.displayName = "AuthButton";

const AuthLayout = () => {
    return (
        <div className={PAGE_CLASS}>
            <a className={SKIP_LINK_CLASS} href="#auth-main">
                {microcopy.a11y.skipToMainContent}
            </a>
            <aside aria-hidden="true" className={HERO_RAIL_CLASS}>
                <div className={HERO_INNER_CLASS}>
                    <div className={HERO_BADGE_CLASS}>
                        <span className={HERO_BADGE_DOT_CLASS} />
                        {microcopy.auth.heroBadge}
                    </div>
                    <h2 className={HERO_TITLE_CLASS}>
                        {microcopy.auth.heroTitle}
                    </h2>
                    <p className={HERO_SUBTITLE_CLASS}>
                        {microcopy.auth.heroSubtitle}
                    </p>
                    <ul className={HERO_FEATURE_LIST_CLASS}>
                        <li className={HERO_FEATURE_CLASS}>
                            <span
                                aria-hidden
                                className={HERO_FEATURE_ICON_CLASS}
                            >
                                <Zap />
                            </span>
                            {microcopy.auth.heroFeatureDraft}
                        </li>
                        <li className={HERO_FEATURE_CLASS}>
                            <span
                                aria-hidden
                                className={HERO_FEATURE_ICON_CLASS}
                            >
                                <Move />
                            </span>
                            {microcopy.auth.heroFeatureDrag}
                        </li>
                        <li className={HERO_FEATURE_CLASS}>
                            <span
                                aria-hidden
                                className={HERO_FEATURE_ICON_CLASS}
                            >
                                <Palette />
                            </span>
                            {microcopy.auth.heroFeatureColors}
                        </li>
                    </ul>
                    <p className={HERO_FINE_PRINT_CLASS}>
                        {microcopy.auth.heroFinePrint}
                    </p>
                </div>
            </aside>
            <main className={CANVAS_CLASS} id="auth-main" tabIndex={-1}>
                <header className={BRAND_HEADER_CLASS}>
                    <BrandMark size="md" />
                </header>
                <Card className={FORM_CARD_CLASS} data-glass-context="true">
                    <div className={FORM_CARD_BODY_CLASS}>
                        {/* Suspense lives inside the layout so the brand chrome
                         * stays mounted while a lazy page chunk fetches. */}
                        <Suspense fallback={<PageSpin />}>
                            <Outlet />
                        </Suspense>
                    </div>
                </Card>
            </main>
        </div>
    );
};

export default AuthLayout;
