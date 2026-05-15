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
});
