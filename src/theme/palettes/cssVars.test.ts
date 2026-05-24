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
            // Wave 2's user-intensity toggle overrides this var to `none`
            // when the user picks the Solid preset. The default value
            // here is what Clear and Regular intensities consume.
            const css = paletteToCss(orangePalette);
            expect(lightBlockOf(css)).toContain(
                "--ant-backdrop-filter-glass: blur(20px) saturate(180%);"
            );
            expect(darkBlockOf(css)).toContain(
                "--ant-backdrop-filter-glass: blur(20px) saturate(180%);"
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
});
