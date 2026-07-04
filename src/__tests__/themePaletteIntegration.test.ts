/**
 * Integration tests for the theme / palette / CSS-vars / AntD-theme stack.
 *
 * The visual identity ships through four parallel surfaces:
 *
 *  1. `src/theme/palettes/index.ts` — the single source of truth.
 *  2. `src/theme/tokens.ts` — JS tokens used by styled-components / emotion.
 *  3. `src/theme/palettes/cssVars.ts` — CSS custom properties injected
 *     before React's first paint (consumed by `App.css` and inline
 *     styles).
 *  4. `src/theme/antdTheme.ts` — AntD's `ThemeConfig` consumed by
 *     `<ConfigProvider>` (drives Buttons, Inputs, Modals, etc.).
 *
 * A regression that updates the palette but forgets to thread the new
 * value through one of these surfaces would split the brand identity in
 * half — the AntD primary would stay orange while the glass borders
 * tinted in a new hue, for instance. This suite pins the cross-surface
 * contract: a single palette swap propagates to all three downstream
 * surfaces consistently.
 */
import { palette } from "../theme/palettes";
import { paletteToCss } from "../theme/palettes/cssVars";
import { emeraldPalette } from "../theme/palettes/emerald";
import { orangePalette } from "../theme/palettes/orange";
import {
    brand,
    accent,
    aurora,
    avatarGradients,
    fontSize
} from "../theme/tokens";
import { buildAntdTheme } from "../theme/antdTheme";

describe("theme/palette integration", () => {
    describe("active palette is propagated to every downstream surface", () => {
        it("tokens.brand references the palette brand via CSS var + orange fallback", () => {
            // Runtime palette switch — the brand tokens are now
            // `var(--pulse-brand-*, <orange literal>)` references so a
            // colour-theme switch re-colors styled-components live. The
            // module-load `palette` is orange, so its hexes are the var
            // fallbacks. We assert the var reference AND the embedded
            // fallback rather than exact equality.
            expect(brand.primary).toMatch(/^var\(--pulse-brand-primary,/);
            expect(brand.primary).toContain(palette.brand.primary);
            expect(brand.primaryHover).toContain(palette.brand.primaryHover);
            expect(brand.primaryActive).toContain(palette.brand.primaryActive);
            expect(brand.primaryBg).toContain(palette.brand.primaryBg);
        });

        it("tokens.accent derivatives reference the palette accent", () => {
            // `start` / `end` flip live via CSS var; `glow` / `selectionBg`
            // have no live consumer and stay plain rgba() literals. Both
            // paths must still embed the active palette's accent so a
            // palette swap re-tints what it can and the fallback matches
            // orange for everything else.
            expect(accent.start).toMatch(/^var\(--pulse-accent-start,/);
            expect(accent.start).toContain(palette.accent.start);
            expect(accent.end).toContain(palette.accent.end);
            expect(accent.glow).toContain(palette.accent.rgb);
            expect(accent.selectionBg).toContain(palette.accent.rgb);
        });

        it("tokens.aurora references palette.aurora via CSS var + orange fallback", () => {
            expect(aurora.deep).toMatch(/^var\(--pulse-aurora-deep,/);
            expect(aurora.deep).toContain(palette.aurora.deep);
            expect(aurora.mid).toContain(palette.aurora.mid);
            expect(aurora.light).toContain(palette.aurora.light);
            expect(aurora.cinematicBase).toContain(
                palette.aurora.cinematicBase
            );
        });

        it("avatarGradients references palette.avatarGradients via CSS var + fallback", () => {
            // Length-6 tuple preserved (gradientFor indexes it by
            // hash % 6); each entry is a var() ref carrying the orange
            // gradient as its fallback.
            expect(avatarGradients).toHaveLength(6);
            palette.avatarGradients.forEach((grad, i) => {
                expect(avatarGradients[i]).toContain(grad);
                expect(avatarGradients[i]).toMatch(
                    new RegExp(`^var\\(--pulse-avatar-grad-${i},`)
                );
            });
        });

        it("AntD theme.colorPrimary lands on the palette brand primary (real hex)", () => {
            // AntD derives shades algorithmically and cannot consume a
            // `var()`, so buildAntdTheme reads the active Palette OBJECT
            // and emits a real hex — the orange default here.
            const cfg = buildAntdTheme("light");
            expect(cfg.token?.colorPrimary).toBe(palette.brand.primary);
        });

        it("paletteToCss(activePalette) embeds the active brand primary", () => {
            const css = paletteToCss(palette);
            expect(css).toContain(palette.brand.primary);
        });
    });

    describe("palette swap propagates through every surface", () => {
        // Build hypothetical "what would emerald look like?" outputs and
        // assert they differ from the orange outputs. This catches a
        // regression where one of the four surfaces hard-codes orange.
        it("paletteToCss output differs between emerald and orange", () => {
            const orangeCss = paletteToCss(orangePalette);
            const emeraldCss = paletteToCss(emeraldPalette);
            expect(orangeCss).not.toBe(emeraldCss);
            // Spot-check the swap by hue:
            expect(orangeCss).toContain(orangePalette.brand.primary);
            expect(emeraldCss).toContain(emeraldPalette.brand.primary);
            expect(orangeCss).not.toContain(emeraldPalette.brand.primary);
        });

        it("emerald CSS uses emerald accent rgb in the light block", () => {
            const css = paletteToCss(emeraldPalette);
            expect(css).toContain(`rgba(${emeraldPalette.accent.rgb}`);
        });

        it("emerald and orange differ on all four AA-anchored brand fields", () => {
            // primary / primaryHover / primaryActive / primaryDark are
            // the AA-anchored color choices. A palette swap must affect
            // every one of them (otherwise the new palette inherits
            // contrast bugs from the old one).
            expect(emeraldPalette.brand.primary).not.toBe(
                orangePalette.brand.primary
            );
            expect(emeraldPalette.brand.primaryHover).not.toBe(
                orangePalette.brand.primaryHover
            );
            expect(emeraldPalette.brand.primaryActive).not.toBe(
                orangePalette.brand.primaryActive
            );
            expect(emeraldPalette.brand.primaryDark).not.toBe(
                orangePalette.brand.primaryDark
            );
        });
    });

    describe("AntD theme stays internally consistent across modes", () => {
        it("light and dark both ship every Button / Modal / Tabs override", () => {
            const light = buildAntdTheme("light");
            const dark = buildAntdTheme("dark");
            for (const comp of [
                "Button",
                "Modal",
                "Tabs",
                "Tag",
                "Tooltip",
                "Layout"
            ] as const) {
                expect(light.components?.[comp]).toBeDefined();
                expect(dark.components?.[comp]).toBeDefined();
            }
        });

        it("coarse-pointer override applies in both light and dark", () => {
            const lightCoarse = buildAntdTheme("light", true);
            const darkCoarse = buildAntdTheme("dark", true);
            const lightHeight = (
                lightCoarse.components?.Button as { controlHeight?: number }
            )?.controlHeight;
            const darkHeight = (
                darkCoarse.components?.Button as { controlHeight?: number }
            )?.controlHeight;
            expect(lightHeight).toBe(darkHeight);
            expect(lightHeight).toBeGreaterThanOrEqual(44);
        });

        it("desktop (fine pointer) keeps the dense 14 / 13 / 16 body ladder", () => {
            const desktop = buildAntdTheme("light");
            expect(desktop.token?.fontSize).toBe(fontSize.base);
            expect(desktop.token?.fontSizeSM).toBe(fontSize.sm);
            expect(desktop.token?.fontSizeLG).toBe(fontSize.md);
        });

        it("coarse pointer lifts the body type scale one step (16 / 14 / 18)", () => {
            // Native iOS/Android body copy reads ~16 px; 14 px feels cramped
            // on a phone. The coarse branch bumps base -> md, SM -> base,
            // LG -> lg so touch body/label copy lands at least 14 px. A
            // regression that drops this back to the dense desktop ladder
            // must fail loudly here.
            const coarse = buildAntdTheme("light", true);
            expect(coarse.token?.fontSize).toBe(fontSize.md);
            expect(coarse.token?.fontSizeSM).toBe(fontSize.base);
            expect(coarse.token?.fontSizeLG).toBe(fontSize.lg);
            expect(coarse.token?.fontSize).toBe(16);
            expect(coarse.token?.fontSizeSM).toBe(14);
            expect(coarse.token?.fontSizeLG).toBe(18);
        });

        it("coarse type-scale lift is identical in light and dark", () => {
            const light = buildAntdTheme("light", true);
            const dark = buildAntdTheme("dark", true);
            expect(dark.token?.fontSize).toBe(light.token?.fontSize);
            expect(dark.token?.fontSizeSM).toBe(light.token?.fontSizeSM);
            expect(dark.token?.fontSizeLG).toBe(light.token?.fontSizeLG);
        });

        it("headings stay unchanged between fine and coarse pointers", () => {
            const desktop = buildAntdTheme("light");
            const coarse = buildAntdTheme("light", true);
            expect(coarse.token?.fontSizeHeading1).toBe(
                desktop.token?.fontSizeHeading1
            );
            expect(coarse.token?.fontSizeHeading2).toBe(
                desktop.token?.fontSizeHeading2
            );
            expect(coarse.token?.fontSizeHeading3).toBe(
                desktop.token?.fontSizeHeading3
            );
        });
    });
});
