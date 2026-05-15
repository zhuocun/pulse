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

import { brand, fontFamily, touchTargetCoarse } from "./tokens";
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
        it("threads the brand primary into colorPrimary / colorInfo", () => {
            const cfg = buildAntdTheme("light");
            expect(cfg.token?.colorPrimary).toBe(brand.primary);
            expect(cfg.token?.colorInfo).toBe(brand.primary);
            expect(cfg.token?.colorPrimaryHover).toBe(brand.primaryHover);
            expect(cfg.token?.colorPrimaryActive).toBe(brand.primaryActive);
        });

        it("links route through primaryHover to clear AA on white", () => {
            // The orange palette documents that link color must use
            // primaryHover for WCAG AA contrast on white. The mapping
            // belongs here in the AntD builder, not in the palette.
            const cfg = buildAntdTheme("light");
            expect(cfg.token?.colorLink).toBe(brand.primaryHover);
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
        it("Tabs inkBar uses the brand primary", () => {
            const cfg = buildAntdTheme("light");
            const tabs = cfg.components?.Tabs as
                | { inkBarColor?: string }
                | undefined;
            expect(tabs?.inkBarColor).toBe(brand.primary);
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
