/**
 * Unit tests for the AntD theme builder (`buildAntdTheme`).
 *
 * The builder takes a light/dark mode and a coarse-pointer flag and
 * returns a `ThemeConfig` consumed by the root `<ConfigProvider>`. A few
 * regressions are worth pinning:
 *
 *  - light vs. dark must pick the matching `algorithm` from AntD.
 *  - coarse-pointer mode must lift `controlHeight` to the touch minimum
 *    so AntD Buttons / Selects render at 44+ px on phones (the project's
 *    WCAG 2.5.5 contract — see `tokens.touchTargetCoarse`).
 *  - the `Modal` `colorBgMask` must differ between light and dark so the
 *    backdrop tints appropriately in each mode.
 */
import { theme as antdTheme } from "antd";

import { emeraldPalette } from "./palettes/emerald";
import { orangePalette } from "./palettes/orange";
import { fontFamily, touchTargetCoarse } from "./tokens";
import {
    accentGradientCss,
    auroraGradientCss,
    buildAntdTheme
} from "./antdTheme";

describe("buildAntdTheme", () => {
    describe("algorithm selection", () => {
        it("picks defaultAlgorithm in light mode", () => {
            const cfg = buildAntdTheme("light");
            expect(cfg.algorithm).toBe(antdTheme.defaultAlgorithm);
        });

        it("picks darkAlgorithm in dark mode", () => {
            const cfg = buildAntdTheme("dark");
            expect(cfg.algorithm).toBe(antdTheme.darkAlgorithm);
        });
    });

    describe("token surface", () => {
        it("threads the default (orange) brand primary into colorPrimary / colorInfo", () => {
            // AntD reads the Palette OBJECT (real hex), not the
            // `var(--pulse-*)` tokens — it derives every shade from a
            // single colorPrimary hex algorithmically. With no palette
            // arg the builder defaults to orange.
            const cfg = buildAntdTheme("light");
            expect(cfg.token?.colorPrimary).toBe(orangePalette.brand.primary);
            expect(cfg.token?.colorInfo).toBe(orangePalette.brand.primary);
            expect(cfg.token?.colorPrimaryHover).toBe(
                orangePalette.brand.primaryHover
            );
            expect(cfg.token?.colorPrimaryActive).toBe(
                orangePalette.brand.primaryActive
            );
        });

        it("threads the supplied palette through colorPrimary (runtime colour-theme switch)", () => {
            // The third `activePalette` arg is what makes the AntD
            // component surface re-color when the user picks a different
            // colour theme. Passing emerald must move colorPrimary (and
            // its derived link/hover steps) onto the emerald hexes.
            const cfg = buildAntdTheme("light", false, emeraldPalette);
            expect(cfg.token?.colorPrimary).toBe(emeraldPalette.brand.primary);
            expect(cfg.token?.colorInfo).toBe(emeraldPalette.brand.primary);
            expect(cfg.token?.colorLink).toBe(
                emeraldPalette.brand.primaryHover
            );
            const tabs = cfg.components?.Tabs as
                | { inkBarColor?: string }
                | undefined;
            expect(tabs?.inkBarColor).toBe(emeraldPalette.brand.primary);
        });

        it("links route through primaryHover to clear AA on white", () => {
            // The orange palette documents that link color must use
            // primaryHover for WCAG AA contrast on white. The mapping
            // belongs here in the AntD builder, not in the palette.
            const cfg = buildAntdTheme("light");
            expect(cfg.token?.colorLink).toBe(orangePalette.brand.primaryHover);
        });

        it("uses Inter font stack as the global fontFamily", () => {
            const cfg = buildAntdTheme("light");
            expect(cfg.token?.fontFamily).toBe(fontFamily.sans);
            expect(cfg.token?.fontFamilyCode).toBe(fontFamily.mono);
        });

        it("flips cssVar key on so AntD writes prefixed runtime vars", () => {
            const cfg = buildAntdTheme("light");
            expect(cfg.cssVar).toEqual({ key: "ant" });
        });
    });

    describe("control height ladder", () => {
        it("uses the Linear-density 36/44/28 ladder on fine pointers", () => {
            const cfg = buildAntdTheme("light", false);
            expect(cfg.token?.controlHeight).toBe(36);
            expect(cfg.token?.controlHeightLG).toBe(44);
            expect(cfg.token?.controlHeightSM).toBe(28);
        });

        it("collapses to the 44 px touch minimum on coarse pointers", () => {
            const cfg = buildAntdTheme("light", true);
            expect(cfg.token?.controlHeight).toBe(touchTargetCoarse);
            expect(cfg.token?.controlHeightLG).toBe(touchTargetCoarse + 8);
            // SM must NOT drop below the touch minimum on touch — that was
            // the WCAG 2.5.5 regression we explicitly guard against.
            expect(cfg.token?.controlHeightSM).toBe(touchTargetCoarse);
        });

        it("threads the coarse-pointer override into Button.controlHeight", () => {
            const cfgFine = buildAntdTheme("light", false);
            const cfgCoarse = buildAntdTheme("light", true);
            expect(
                (cfgFine.components?.Button as { controlHeight?: number })
                    ?.controlHeight
            ).toBe(36);
            expect(
                (cfgCoarse.components?.Button as { controlHeight?: number })
                    ?.controlHeight
            ).toBe(touchTargetCoarse);
        });

        it("threads the coarse-pointer override into Select.optionHeight", () => {
            const cfgFine = buildAntdTheme("light", false);
            const cfgCoarse = buildAntdTheme("light", true);
            expect(
                (cfgFine.components?.Select as { optionHeight?: number })
                    ?.optionHeight
            ).toBe(32);
            expect(
                (cfgCoarse.components?.Select as { optionHeight?: number })
                    ?.optionHeight
            ).toBe(touchTargetCoarse);
        });

        // WCAG 2.5.8 — each Segmented option is an independent tap target.
        // On coarse pointers the control heights pin to the 44 px floor and
        // the track inset drops to 0 so the option fills the full 44 px
        // (a non-zero inset would shave it to 40 px). Desktop keeps the
        // dense 36/44/28 ladder with the default 2 px inset.
        it("pins the Segmented option height to the 44 px floor on coarse pointers", () => {
            const fine = buildAntdTheme("light", false).components
                ?.Segmented as
                | {
                      controlHeight?: number;
                      controlHeightSM?: number;
                      trackPadding?: number;
                  }
                | undefined;
            const coarse = buildAntdTheme("light", true).components
                ?.Segmented as
                | {
                      controlHeight?: number;
                      controlHeightLG?: number;
                      controlHeightSM?: number;
                      trackPadding?: number;
                  }
                | undefined;

            expect(fine?.controlHeight).toBe(36);
            expect(fine?.controlHeightSM).toBe(28);
            expect(fine?.trackPadding).toBe(2);

            expect(coarse?.controlHeight).toBe(touchTargetCoarse);
            expect(coarse?.controlHeightLG).toBe(touchTargetCoarse);
            expect(coarse?.controlHeightSM).toBe(touchTargetCoarse);
            // Zero inset means labelHeight === controlHeight === 44, so the
            // small-size board-density picker clears the floor too.
            expect(coarse?.trackPadding).toBe(0);
        });

        // WCAG 2.5.8 — the dense desktop Dropdown padding (space.xxs) caps a
        // menu row at ~32 px on touch. On coarse pointers the vertical
        // padding grows so each row clears 44 px (content 24 px + 2 × 10 px).
        it("pads Dropdown menu rows to the 44 px floor on coarse pointers", () => {
            const fine = buildAntdTheme("light", false).components?.Dropdown as
                | { paddingBlock?: number }
                | undefined;
            const coarse = buildAntdTheme("light", true).components
                ?.Dropdown as { paddingBlock?: number } | undefined;

            expect(fine?.paddingBlock).toBe(4);
            // fontSize.md (16) × lineHeight.normal (1.5) = 24 px content;
            // (44 − 24) / 2 = 10 px on each edge → 44 px row.
            expect(coarse?.paddingBlock).toBe(10);
        });
    });

    describe("Modal component overrides", () => {
        it("sets a darker mask in dark mode than in light mode", () => {
            const light = buildAntdTheme("light").components?.Modal as
                | { colorBgMask?: string }
                | undefined;
            const dark = buildAntdTheme("dark").components?.Modal as
                | { colorBgMask?: string }
                | undefined;
            expect(typeof light?.colorBgMask).toBe("string");
            expect(typeof dark?.colorBgMask).toBe("string");
            expect(light?.colorBgMask).not.toBe(dark?.colorBgMask);
        });

        it("leaves Modal header/footer backgrounds transparent (App.css owns the surface)", () => {
            const cfg = buildAntdTheme("light");
            const modal = cfg.components?.Modal as
                | { headerBg?: string; footerBg?: string }
                | undefined;
            expect(modal?.headerBg).toBe("transparent");
            expect(modal?.footerBg).toBe("transparent");
        });
    });

    describe("Layout/Tag component overrides", () => {
        it("Layout backgrounds are transparent so the page wash shows through", () => {
            const cfg = buildAntdTheme("light");
            const layout = cfg.components?.Layout as
                | { headerBg?: string; bodyBg?: string }
                | undefined;
            expect(layout?.headerBg).toBe("transparent");
            expect(layout?.bodyBg).toBe("transparent");
        });

        it("Tag default colors differ between light and dark modes", () => {
            const light = buildAntdTheme("light").components?.Tag as
                | { defaultBg?: string; defaultColor?: string }
                | undefined;
            const dark = buildAntdTheme("dark").components?.Tag as
                | { defaultBg?: string; defaultColor?: string }
                | undefined;
            expect(light?.defaultBg).not.toBe(dark?.defaultBg);
            expect(light?.defaultColor).not.toBe(dark?.defaultColor);
        });
    });

    describe("Tabs / Tooltip overrides", () => {
        it("Tabs inkBar uses the brand primary (default orange hex)", () => {
            const cfg = buildAntdTheme("light");
            const tabs = cfg.components?.Tabs as
                | { inkBarColor?: string }
                | undefined;
            expect(tabs?.inkBarColor).toBe(orangePalette.brand.primary);
        });

        it("Tooltip spotlight tint differs between light and dark", () => {
            const light = buildAntdTheme("light").components?.Tooltip as
                | { colorBgSpotlight?: string }
                | undefined;
            const dark = buildAntdTheme("dark").components?.Tooltip as
                | { colorBgSpotlight?: string }
                | undefined;
            expect(light?.colorBgSpotlight).not.toBe(dark?.colorBgSpotlight);
        });
    });
});

describe("accentGradientCss / auroraGradientCss exports", () => {
    it("accentGradientCss is a CSS linear-gradient with two stops", () => {
        expect(accentGradientCss).toMatch(/^linear-gradient\(/);
        expect(accentGradientCss).toMatch(/0%/);
        expect(accentGradientCss).toMatch(/100%/);
    });

    it("auroraGradientCss is a CSS linear-gradient string", () => {
        expect(auroraGradientCss).toMatch(/^linear-gradient\(/);
    });
});
