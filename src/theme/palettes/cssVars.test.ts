/**
 * Unit tests for `paletteToCss` — the CSS-vars renderer mounted
 * synchronously in `index.tsx` before React's first paint.
 *
 * If a `--color-copilot-*` var stops appearing, the AI surfaces fall back
 * to the literal hex baked into `aiTokens.ts` (so dark mode wouldn't
 * flip). If the `--glass-*` vars stop appearing, frosted surfaces fall
 * back to white tints, which looks broken in dark mode.
 *
 * The tests scan the rendered CSS string for the contract — the exact
 * format is tolerant (whitespace / ordering) but the variable set is
 * not.
 */
import { glass } from "../tokens";

import { paletteToCss } from "./cssVars";
import { emeraldPalette } from "./emerald";
import { orangePalette } from "./orange";

// Required vars that MUST appear in the light block. Each one anchors a
// concrete consumer (see comments in the corresponding token file).
const REQUIRED_LIGHT_VARS = [
    "--pulse-bg-page",
    "--pulse-text-base",
    "--color-copilot-grad-start",
    "--color-copilot-grad-mid",
    "--color-copilot-grad-end",
    "--color-copilot-bg-subtle",
    "--color-copilot-bg-medium",
    "--color-copilot-badge",
    "--color-copilot-badge-bg",
    "--color-copilot-pulse",
    "--glass-surface",
    "--glass-surface-strong",
    "--glass-surface-subtle",
    "--glass-border",
    "--glass-border-strong",
    "--glass-shine",
    // Phase 5 "Liquid Glass" additions (Wave 1 T1). Wave 2 consumers
    // depend on every one of these being present in BOTH palette blocks;
    // a regression that drops one in dark mode would leave specular
    // highlights stuck at the light-mode value, breaking the contract.
    "--glass-specular-top",
    "--glass-specular-bottom",
    "--glass-refraction-tint",
    "--glass-shadow-on-text",
    "--glass-shadow-on-solid",
    "--glass-rim-subtle",
    "--glass-rim",
    "--glass-rim-strong",
    "--motion-morph",
    "--motion-gel-flex",
    "--easing-spring-soft",
    "--easing-spring-snap",
    "--ant-backdrop-filter-glass",
    // Wave 2 integration — per-surface-tier intensity vars so the user
    // toggle reaches subtle / regular / strong surfaces without forcing
    // a uniform-blur compromise.
    "--ant-backdrop-filter-glass-subtle",
    "--ant-backdrop-filter-glass-strong",
    "--aurora-blob",
    "--aurora-blob-strong",
    "--aurora-blob-faint"
] as const;

describe("paletteToCss", () => {
    const lightBlockOf = (css: string): string => {
        // Light block starts with `:root,` and ends right before the
        // `html[data-color-scheme="dark"]` block.
        const lightStart = css.indexOf(":root,");
        const darkStart = css.indexOf('html[data-color-scheme="dark"]');
        if (lightStart < 0 || darkStart < 0) {
            throw new Error("rendered CSS missing light or dark block");
        }
        return css.slice(lightStart, darkStart);
    };

    const darkBlockOf = (css: string): string => {
        const darkStart = css.indexOf('html[data-color-scheme="dark"]');
        if (darkStart < 0) {
            throw new Error("rendered CSS missing dark block");
        }
        return css.slice(darkStart);
    };

    it("renders both :root/light and html[data-color-scheme='dark'] blocks", () => {
        const css = paletteToCss(orangePalette);
        expect(css).toContain(":root,");
        expect(css).toContain('html[data-color-scheme="light"]');
        expect(css).toContain('html[data-color-scheme="dark"]');
    });

    it.each(REQUIRED_LIGHT_VARS)(
        "declares %s in the light block",
        (varName) => {
            const css = paletteToCss(orangePalette);
            expect(lightBlockOf(css)).toContain(`${varName}:`);
        }
    );

    it.each(REQUIRED_LIGHT_VARS)("declares %s in the dark block", (varName) => {
        const css = paletteToCss(orangePalette);
        expect(darkBlockOf(css)).toContain(`${varName}:`);
    });

    it("light --pulse-bg-page uses palette.page.bgLight", () => {
        const css = paletteToCss(orangePalette);
        expect(lightBlockOf(css)).toContain(
            `--pulse-bg-page: ${orangePalette.page.bgLight};`
        );
    });

    it("dark --pulse-bg-page uses palette.page.bgDark", () => {
        const css = paletteToCss(orangePalette);
        expect(darkBlockOf(css)).toContain(
            `--pulse-bg-page: ${orangePalette.page.bgDark};`
        );
    });

    it("light gradient stops follow aurora.deep/mid/light", () => {
        const css = paletteToCss(orangePalette);
        const light = lightBlockOf(css);
        expect(light).toContain(
            `--color-copilot-grad-start: ${orangePalette.aurora.deep};`
        );
        expect(light).toContain(
            `--color-copilot-grad-mid: ${orangePalette.aurora.mid};`
        );
        expect(light).toContain(
            `--color-copilot-grad-end: ${orangePalette.aurora.light};`
        );
    });

    it("dark gradient start swaps to brand.primaryDark (AA on dark)", () => {
        const css = paletteToCss(orangePalette);
        const dark = darkBlockOf(css);
        expect(dark).toContain(
            `--color-copilot-grad-start: ${orangePalette.brand.primaryDark};`
        );
    });

    it("light variants use accent.rgb; dark variants use accent.rgbDark", () => {
        const css = paletteToCss(orangePalette);
        const light = lightBlockOf(css);
        const dark = darkBlockOf(css);

        // The light block must reference the light rgb triplet AND must
        // NOT reference the dark rgb triplet — that would be a contrast
        // regression.
        expect(light).toContain(`rgba(${orangePalette.accent.rgb}`);
        expect(light).not.toContain(`rgba(${orangePalette.accent.rgbDark}`);

        // And vice-versa.
        expect(dark).toContain(`rgba(${orangePalette.accent.rgbDark}`);
        expect(dark).not.toContain(`rgba(${orangePalette.accent.rgb}`);
    });

    it("renders the same shape for any palette (emerald)", () => {
        const css = paletteToCss(emeraldPalette);
        expect(css).toContain(
            `--pulse-bg-page: ${emeraldPalette.page.bgLight};`
        );
        expect(darkBlockOf(css)).toContain(
            `--pulse-bg-page: ${emeraldPalette.page.bgDark};`
        );
        // Emerald-specific identity: the rendered CSS must reference the
        // emerald palette's accent rgb in the light block.
        expect(lightBlockOf(css)).toContain(
            `rgba(${emeraldPalette.accent.rgb}`
        );
    });

    it("re-rendering for the same palette is idempotent (text-equal output)", () => {
        // CSS injection happens once per palette switch; the same input
        // must produce the same output (no Date.now() / random tokens).
        expect(paletteToCss(orangePalette)).toBe(paletteToCss(orangePalette));
    });

    describe("Phase 5 Liquid Glass vars", () => {
        it("light --glass-refraction-tint derives from accent.rgb", () => {
            const css = paletteToCss(orangePalette);
            expect(lightBlockOf(css)).toContain(
                `--glass-refraction-tint: rgba(${orangePalette.accent.rgb}, 0.05);`
            );
        });

        it("dark --glass-refraction-tint derives from accent.rgbDark", () => {
            const css = paletteToCss(orangePalette);
            expect(darkBlockOf(css)).toContain(
                `--glass-refraction-tint: rgba(${orangePalette.accent.rgbDark}, 0.08);`
            );
        });

        it("emerald --glass-refraction-tint follows the emerald accent (palette swap contract)", () => {
            // A regression where refractionTint is hardcoded rather than
            // derived from the active accent would leave the highlight
            // tinted orange in emerald mode. This test pins the swap.
            const css = paletteToCss(emeraldPalette);
            expect(lightBlockOf(css)).toContain(
                `--glass-refraction-tint: rgba(${emeraldPalette.accent.rgb}`
            );
            expect(darkBlockOf(css)).toContain(
                `--glass-refraction-tint: rgba(${emeraldPalette.accent.rgbDark}`
            );
        });

        it("--ant-backdrop-filter-glass defaults to the regular blur+saturate combo", () => {
            // The default (:root) value is the Regular preset
            // recipe — `blur(20px) saturate(180%)` — and is what the
            // unmodified chrome consumes after the Wave 2 T4 line
            // migration (`backdrop-filter: var(--ant-backdrop-filter-
            // glass)`). The user-intensity toggle in Wave 2 T4 ships
            // `html[data-glass-intensity="clear" | "solid"]` overrides
            // that swap this default; tests for those overrides live
            // in the dedicated `glass-intensity overrides` describe
            // block below.
            const css = paletteToCss(orangePalette);
            // Use a regex anchored to the `:root,` declaration so we
            // don't accidentally match the override block's value.
            const rootBlock = lightBlockOf(css);
            expect(rootBlock).toMatch(
                /--ant-backdrop-filter-glass:\s*blur\(20px\)\s*saturate\(180%\);/
            );
            expect(darkBlockOf(css)).toMatch(
                /--ant-backdrop-filter-glass:\s*blur\(20px\)\s*saturate\(180%\);/
            );
        });

        it("specular highlights are achromatic (neutral white / black, no accent leak)", () => {
            // Specular models an uncolored light source; if a palette
            // accent leaks into the specular gradient, the rim picks up
            // the brand hue and the "liquid" illusion breaks. This pins
            // that the specular gradients reference only neutrals.
            const css = paletteToCss(orangePalette);
            const light = lightBlockOf(css);
            // Light specular-top declaration line should contain only
            // the neutral white triplet, not the orange accent.
            const specTopLine = light.match(/--glass-specular-top:[^;]*;/);
            expect(specTopLine).not.toBeNull();
            expect(specTopLine![0]).not.toContain(orangePalette.accent.rgb);
        });

        it("dark specular is lower-amplitude than light specular (physics)", () => {
            // A bright rim on a dark surface reads as much hotter than
            // the same value on a light surface. The dark variant must
            // drop the highlight amplitude — codified as 0.18 vs. 0.30
            // in the token comments.
            const css = paletteToCss(orangePalette);
            expect(lightBlockOf(css)).toContain("rgba(255, 255, 255, 0.30)");
            expect(darkBlockOf(css)).toContain("rgba(220, 235, 255, 0.18)");
        });

        it("rim hairlines ramp upward in opacity (subtle < default < strong)", () => {
            // Wave 2 will pick rimSubtle for resting state, rim for the
            // default ring, and rimStrong for hover / active. The ramp
            // direction must be monotonic so the visual hierarchy of
            // edge-engagement reads as intended.
            const css = paletteToCss(orangePalette);
            const light = lightBlockOf(css);
            const subtle = light.match(
                /--glass-rim-subtle: rgba\(255, 255, 255, ([\d.]+)\);/
            );
            const mid = light.match(
                /--glass-rim: rgba\(255, 255, 255, ([\d.]+)\);/
            );
            const strong = light.match(
                /--glass-rim-strong: rgba\(255, 255, 255, ([\d.]+)\);/
            );
            expect(subtle).not.toBeNull();
            expect(mid).not.toBeNull();
            expect(strong).not.toBeNull();
            const subtleA = Number(subtle![1]);
            const midA = Number(mid![1]);
            const strongA = Number(strong![1]);
            expect(midA).toBeGreaterThan(subtleA);
            expect(strongA).toBeGreaterThan(midA);
        });
    });

    /*
     * Phase 5 Wave 2 T4 — user-facing glass-intensity toggle. The
     * cssVars renderer emits `html[data-glass-intensity="clear" |
     * "solid"]` selectors that override `--ant-backdrop-filter-glass`,
     * plus a `prefers-reduced-transparency` belt-and-suspenders block
     * that pins the var to `none` regardless of the user choice.
     * "regular" inherits the :root default and intentionally has no
     * override block (lean CSS).
     */
    describe("Phase 5 Wave 2 T4 glass-intensity overrides", () => {
        it("emits a clear-intensity override block", () => {
            const css = paletteToCss(orangePalette);
            expect(css).toContain('html[data-glass-intensity="clear"]');
            // The clear preset composes from `glass.intensityClear` —
            // blur 14, saturation 170%. Pinning the literal here
            // catches a regression where the token shape diverges
            // from the cssVars renderer.
            expect(css).toMatch(
                /html\[data-glass-intensity="clear"\]\s*\{\s*--ant-backdrop-filter-glass:\s*blur\(14px\)\s*saturate\(170%\);/
            );
        });

        it("emits a solid-intensity override block that wipes the filter (blur=0 → none)", () => {
            const css = paletteToCss(orangePalette);
            expect(css).toContain('html[data-glass-intensity="solid"]');
            // The solid preset has `blur: 0` which composes to the
            // literal `none` (the property-cancelling value), NOT
            // `blur(0px) saturate(180%)`. The `none` form lets
            // `-webkit-backdrop-filter` polyfills opt the property
            // out entirely on platforms that interpret blur(0px) as
            // "the filter is still active".
            expect(css).toMatch(
                /html\[data-glass-intensity="solid"\]\s*\{\s*--ant-backdrop-filter-glass:\s*none;/
            );
        });

        it("does NOT emit a regular-intensity override block (inherits the :root default)", () => {
            // The Regular preset matches the :root default value, so
            // emitting an override would be dead bytes. Pin that the
            // selector doesn't appear so a future refactor that adds
            // a per-intensity rule for "regular" trips a conscious
            // review.
            const css = paletteToCss(orangePalette);
            expect(css).not.toContain('html[data-glass-intensity="regular"]');
        });

        it("ships a prefers-reduced-transparency override that pins the var to none (OS wins)", () => {
            // Belt-and-suspenders: even when the user picked "clear"
            // we still respect the OS-level accessibility signal.
            // Mirrors the App.css [data-glass-context] override that
            // wipes GlassPanel's prop-driven blur on the same query.
            const css = paletteToCss(orangePalette);
            expect(css).toMatch(
                /@media \(prefers-reduced-transparency: reduce\)[\s\S]*--ant-backdrop-filter-glass:\s*none;/
            );
        });

        it("derives the override values from glass.intensity tokens (palette-independent)", () => {
            // The override blocks should produce the SAME var values
            // for any palette — they're driven by glass.intensity*
            // tokens which don't reference the active palette. A
            // regression where the override picks up a palette-
            // specific value would silently differ between brand
            // swaps.
            const orangeCss = paletteToCss(orangePalette);
            const emeraldCss = paletteToCss(emeraldPalette);
            const extractClearOverride = (css: string) =>
                css.match(
                    /html\[data-glass-intensity="clear"\]\s*\{\s*--ant-backdrop-filter-glass:\s*([^;]+);/
                )?.[1];
            expect(extractClearOverride(orangeCss)).toBe(
                extractClearOverride(emeraldCss)
            );
        });

        /*
         * cssVars.ts mirrors `glass.intensity*` `{blur, saturation}`
         * fields as in-file constants because importing the `glass`
         * token from `../tokens` would create a load-time cycle
         * (tokens → palettes/index → cssVars). This test pins that
         * the mirror stays in sync with the token source — a future
         * edit to the intensity values in `tokens.ts` without
         * mirroring here would fail the assertion before drifting
         * downstream into either the chrome var override or the
         * GlassPanel prop-driven recipe.
         */
        it("intensity constants stay in sync with glass.intensity tokens (mirror parity)", () => {
            const css = paletteToCss(orangePalette);
            // Clear override block now ships three lines (one var per
            // surface tier — subtle, regular, strong). The base var is
            // glass.intensityClear-driven; the subtle/strong vars are
            // sibling presets in the cssVars mirror.
            expect(css).toMatch(
                new RegExp(
                    `html\\[data-glass-intensity="clear"\\]\\s*\\{[\\s\\S]*?--ant-backdrop-filter-glass:\\s*blur\\(${glass.intensityClear.blur}px\\)\\s*saturate\\(${glass.intensityClear.saturation}%\\);`
                )
            );
            // Solid override → blur === 0 composes to "none" for all
            // three vars.
            expect(glass.intensitySolid.blur).toBe(0);
            expect(css).toMatch(
                /html\[data-glass-intensity="solid"\]\s*\{\s*--ant-backdrop-filter-glass:\s*none;[\s\S]*?--ant-backdrop-filter-glass-subtle:\s*none;[\s\S]*?--ant-backdrop-filter-glass-strong:\s*none;[\s\S]*?\}/
            );
            // Regular default at :root → uses glass.intensityRegular.
            expect(css).toContain(
                `--ant-backdrop-filter-glass: blur(${glass.intensityRegular.blur}px) saturate(${glass.intensityRegular.saturation}%);`
            );
        });

        /*
         * Wave 2 integration — the per-tier intensity ladder. Subtle
         * and strong vars sit alongside the regular var so chrome
         * surfaces that previously shipped 12 px (ColumnHeader) or
         * 28 px (auth FormCard) can keep their blur character while
         * still flipping under the user toggle.
         */
        it("emits --ant-backdrop-filter-glass-subtle at the subtle tier default", () => {
            const css = paletteToCss(orangePalette);
            // Subtle tier default: 12 px / 180% (matches the column
            // header's pre-toggle recipe pixel-for-pixel).
            expect(lightBlockOf(css)).toMatch(
                /--ant-backdrop-filter-glass-subtle:\s*blur\(12px\)\s*saturate\(180%\);/
            );
            expect(darkBlockOf(css)).toMatch(
                /--ant-backdrop-filter-glass-subtle:\s*blur\(12px\)\s*saturate\(180%\);/
            );
        });

        it("emits --ant-backdrop-filter-glass-strong at the strong tier default", () => {
            const css = paletteToCss(orangePalette);
            // Strong tier default: 28 px / 180% (matches the auth
            // FormCard's pre-toggle showpiece recipe pixel-for-pixel).
            expect(lightBlockOf(css)).toMatch(
                /--ant-backdrop-filter-glass-strong:\s*blur\(28px\)\s*saturate\(180%\);/
            );
            expect(darkBlockOf(css)).toMatch(
                /--ant-backdrop-filter-glass-strong:\s*blur\(28px\)\s*saturate\(180%\);/
            );
        });

        it("scales the subtle + strong vars under clear intensity", () => {
            // Clear softens every tier proportionally — subtle drops
            // to 8 px / 170%, strong drops to 20 px / 180%.
            const css = paletteToCss(orangePalette);
            expect(css).toMatch(
                /html\[data-glass-intensity="clear"\][\s\S]*?--ant-backdrop-filter-glass-subtle:\s*blur\(8px\)\s*saturate\(170%\);/
            );
            expect(css).toMatch(
                /html\[data-glass-intensity="clear"\][\s\S]*?--ant-backdrop-filter-glass-strong:\s*blur\(20px\)\s*saturate\(180%\);/
            );
        });

        it("wipes the subtle + strong vars under solid intensity (all become none)", () => {
            const css = paletteToCss(orangePalette);
            expect(css).toMatch(
                /html\[data-glass-intensity="solid"\][\s\S]*?--ant-backdrop-filter-glass-subtle:\s*none;[\s\S]*?--ant-backdrop-filter-glass-strong:\s*none;/
            );
        });

        it("wipes the subtle + strong vars under prefers-reduced-transparency (OS wins)", () => {
            const css = paletteToCss(orangePalette);
            expect(css).toMatch(
                /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?--ant-backdrop-filter-glass-subtle:\s*none;[\s\S]*?--ant-backdrop-filter-glass-strong:\s*none;/
            );
        });
    });
});
