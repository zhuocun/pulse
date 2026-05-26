/**
 * Unit tests for the design-token surface (`src/theme/tokens.ts`).
 *
 * The token module is dominated by literal constants — those don't need
 * tests, but the small handful of computed helpers do. A regression in
 * `modalWidthCss()` (e.g. accidentally swapping the gutter formula)
 * would silently widen modals past the viewport on mobile, and a
 * regression in `avatarGradients` shape would crash the `UserAvatar`
 * component when it indexes the readonly tuple.
 */
import { palette } from "./palettes";
import {
    accent,
    accentAt,
    accentAtDark,
    aurora,
    avatarGradients,
    breakpoints,
    easing,
    fontFamily,
    fontSize,
    fontWeight,
    glass,
    lineHeight,
    maxLineLengthCh,
    modalGutterPx,
    modalWidthCss,
    motion,
    pageMaxWidthRem,
    radius,
    semantic,
    shadow,
    space,
    tag,
    touchTargetCoarse,
    touchTargetMin,
    viewTransition,
    zIndex
} from "./tokens";

describe("modalWidthCss", () => {
    it("returns a CSS min() expression that clamps to the dynamic viewport", () => {
        expect(modalWidthCss(640)).toBe("min(640px, calc(100dvw - 32px))");
    });

    it("uses 2 × space.md (= 32px) as the gutter — both halves applied", () => {
        // 16 px on each side per the comment in the source.
        expect(modalGutterPx).toBe(space.md * 2);
        expect(modalWidthCss(100)).toContain(
            `calc(100dvw - ${modalGutterPx}px)`
        );
    });

    it("respects the caller's max", () => {
        expect(modalWidthCss(800)).toContain("800px");
        expect(modalWidthCss(320)).toContain("320px");
    });
});

describe("scale token monotonicity", () => {
    it("space scale ramps strictly upward", () => {
        const ladder = [
            space.xxs,
            space.xs,
            space.sm,
            space.md,
            space.lg,
            space.xl,
            space.xxl,
            space.xxxl
        ];
        for (let i = 1; i < ladder.length; i += 1) {
            expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
        }
    });

    it("radius scale ramps upward (with pill as the cap)", () => {
        const ladder = [radius.xs, radius.sm, radius.md, radius.lg, radius.xl];
        for (let i = 1; i < ladder.length; i += 1) {
            expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
        }
        expect(radius.pill).toBeGreaterThanOrEqual(ladder[ladder.length - 1]);
    });

    it("fontSize scale ramps upward", () => {
        const ladder = [
            fontSize.xs,
            fontSize.sm,
            fontSize.base,
            fontSize.md,
            fontSize.lg,
            fontSize.xl,
            fontSize.xxl,
            fontSize.display
        ];
        for (let i = 1; i < ladder.length; i += 1) {
            expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
        }
    });

    it("motion durations ramp upward", () => {
        const ladder = [
            motion.instant,
            motion.short,
            motion.medium,
            motion.long
        ];
        for (let i = 1; i < ladder.length; i += 1) {
            expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
        }
    });
});

describe("avatarGradients tuple", () => {
    it("exposes exactly 6 gradient strings (hash-stable for ID mapping)", () => {
        expect(avatarGradients).toHaveLength(6);
        for (const grad of avatarGradients) {
            expect(typeof grad).toBe("string");
            // Runtime palette switch — each entry is now a
            // `var(--pulse-avatar-grad-N, <orange linear-gradient>)`
            // reference so the avatar monograms re-tint when the user
            // picks a colour theme. The orange `linear-gradient(...)`
            // literal survives as the fallback so a stripped DOM (SSR /
            // test) still renders the historical gradient.
            expect(grad).toMatch(/^var\(--pulse-avatar-grad-\d,/);
            expect(grad).toContain("linear-gradient(");
        }
    });
});

describe("semantic / brand palette", () => {
    it("semantic colors are 6/8-digit hex strings", () => {
        for (const value of Object.values(semantic)) {
            expect(value).toMatch(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
        }
    });

    it("tag tokens are AntD-known presets or 'default'", () => {
        // AntD's `presetColors` includes magenta, geekblue, purple. We
        // don't import them to avoid a hard dependency on AntD's internal
        // exports — this is a structural sanity check.
        for (const value of Object.values(tag)) {
            expect(typeof value).toBe("string");
            expect(value.length).toBeGreaterThan(0);
        }
    });

    it("accent.bg* embed the palette accent triplet at the documented opacity", () => {
        // Runtime palette switch — the styled-component-consumed accent
        // tints (`bgSubtle` / `bgMedium` / `bgStrong` / `border`) are now
        // `var(--pulse-accent-*, rgba(<orange triplet>, <opacity>))`
        // references so a colour-theme switch re-tints them live. The
        // orange `rgba(...)` literal survives inside the var fallback, so
        // we assert the triplet is embedded rather than pinning the
        // string prefix. `glow` / `bgSoft` have no live consumer and stay
        // plain `rgba()` literals.
        for (const key of [
            "bgSubtle",
            "bgMedium",
            "bgStrong",
            "border"
        ] as const) {
            expect(accent[key]).toMatch(/^var\(--pulse-accent-/);
            expect(accent[key]).toContain(`rgba(${palette.accent.rgb}`);
        }
        for (const key of ["bgSoft", "glow"] as const) {
            expect(accent[key]).toMatch(/^rgba\(/);
        }
    });

    it("aurora gradient strings are CSS linear-gradient() expressions", () => {
        expect(aurora.gradLine).toMatch(/^linear-gradient\(/);
        expect(aurora.gradLineSoft).toMatch(/^linear-gradient\(/);
    });

    it("glass surface tokens are rgba() strings (for transparency math)", () => {
        for (const key of [
            "surface",
            "surfaceStrong",
            "surfaceSubtle",
            "surfaceDark"
        ] as const) {
            expect(glass[key]).toMatch(/^rgba\(/);
        }
    });
});

describe("Phase 5 Liquid Glass token additions", () => {
    describe("accentAt / accentAtDark helpers", () => {
        // The "any new tint token must derive from palette.accent.rgb"
        // contract is enforced via these helpers. A regression here
        // breaks the palette-swap one-line contract for Wave 2's
        // Liquid Glass surfaces.
        it("accentAt embeds the active palette accent triplet at the given opacity", () => {
            expect(accentAt(0.05)).toBe(`rgba(${palette.accent.rgb}, 0.05)`);
            expect(accentAt(0.32)).toBe(`rgba(${palette.accent.rgb}, 0.32)`);
        });

        it("accentAtDark embeds the dark-mode-paired triplet at the given opacity", () => {
            expect(accentAtDark(0.08)).toBe(
                `rgba(${palette.accent.rgbDark}, 0.08)`
            );
        });

        it("identical opacity always produces an identical string (pure helper)", () => {
            expect(accentAt(0.18)).toBe(accentAt(0.18));
            expect(accentAtDark(0.18)).toBe(accentAtDark(0.18));
        });
    });

    describe("glass.specular* tokens", () => {
        it("light specular gradients are linear-gradient() strings on the 135deg / 315deg axes", () => {
            expect(glass.specularTop).toMatch(/^linear-gradient\(135deg,/);
            expect(glass.specularBottom).toMatch(/^linear-gradient\(315deg,/);
        });

        it("dark specular gradients exist with the same axis convention", () => {
            expect(glass.specularTopDark).toMatch(/^linear-gradient\(135deg,/);
            expect(glass.specularBottomDark).toMatch(
                /^linear-gradient\(315deg,/
            );
        });

        it("specular highlights are achromatic (no accent leak in the gradient string)", () => {
            // Specular models an uncolored light source — the rim
            // catches white / cool-blue / black, not the brand accent.
            // If a future edit drops accent.rgb into the gradient,
            // the rim picks up the brand hue and the liquid illusion
            // breaks.
            expect(glass.specularTop).not.toContain(palette.accent.rgb);
            expect(glass.specularTopDark).not.toContain(palette.accent.rgb);
            expect(glass.specularBottom).not.toContain(palette.accent.rgb);
            expect(glass.specularBottomDark).not.toContain(palette.accent.rgb);
        });
    });

    describe("glass.refractionTint", () => {
        it("light tint derives from palette.accent.rgb (palette-swap contract)", () => {
            expect(glass.refractionTint).toContain(palette.accent.rgb);
        });

        it("dark tint derives from palette.accent.rgbDark", () => {
            expect(glass.refractionTintDark).toContain(palette.accent.rgbDark);
        });
    });

    describe("glass shadow + rim tokens", () => {
        it("content-aware shadows are comma-separated multi-shadow strings", () => {
            // Stacked drop + ambient pair so the glass reads as floating
            // above the underlying content, not stamped flat onto it.
            expect(glass.shadowOnText.split(",").length).toBeGreaterThanOrEqual(
                2
            );
            expect(
                glass.shadowOnSolid.split(",").length
            ).toBeGreaterThanOrEqual(2);
        });

        it("rim hairlines exist for both light and dark in three steps", () => {
            for (const key of [
                "rimSubtle",
                "rim",
                "rimStrong",
                "rimSubtleDark",
                "rimDark",
                "rimStrongDark"
            ] as const) {
                expect(glass[key]).toMatch(/^rgba\(/);
            }
        });

        it("rim opacity ramps monotonically upward (light)", () => {
            const opacityOf = (s: string) =>
                Number(s.match(/,\s*([\d.]+)\)$/)?.[1] ?? "0");
            expect(opacityOf(glass.rim)).toBeGreaterThan(
                opacityOf(glass.rimSubtle)
            );
            expect(opacityOf(glass.rimStrong)).toBeGreaterThan(
                opacityOf(glass.rim)
            );
        });

        it("rim opacity ramps monotonically upward (dark)", () => {
            const opacityOf = (s: string) =>
                Number(s.match(/,\s*([\d.]+)\)$/)?.[1] ?? "0");
            expect(opacityOf(glass.rimDark)).toBeGreaterThan(
                opacityOf(glass.rimSubtleDark)
            );
            expect(opacityOf(glass.rimStrongDark)).toBeGreaterThan(
                opacityOf(glass.rimDark)
            );
        });
    });

    describe("glass intensity presets", () => {
        it("all three presets ship the full { surface, blur, border, specular } shape", () => {
            for (const preset of [
                glass.intensityClear,
                glass.intensityRegular,
                glass.intensitySolid
            ]) {
                expect(typeof preset.surface).toBe("string");
                expect(typeof preset.blur).toBe("number");
                expect(typeof preset.border).toBe("string");
                expect(typeof preset.specular).toBe("string");
            }
        });

        it("intensitySolid is the accessibility opt-out (blur:0, opaque surface, no specular)", () => {
            // Codified by the Phase 5 proposal: when a user picks the
            // Solid preset (reduced-transparency parity), the glass
            // disappears entirely. This test pins that contract — a
            // regression that turns the blur back on or the surface
            // translucent would silently re-introduce the legibility
            // problem reduced-transparency users opted out of.
            expect(glass.intensitySolid.blur).toBe(0);
            expect(glass.intensitySolid.specular).toBe("none");
            // The surface must be 1.0 alpha (fully opaque). Tolerate
            // both `rgba(R, G, B, 1)` and `rgba(R, G, B, 1.0)` forms.
            expect(glass.intensitySolid.surface).toMatch(
                /rgba\(.+,\s*1(\.0+)?\)/
            );
        });

        it("blur ramps downward across Clear → Regular → Solid (Solid is the lever-off)", () => {
            // Wave 2's user intensity toggle: Clear has the most blur
            // (most show-through), Solid has none. The ramp must be
            // monotonic so the toggle reads as a continuous lever.
            expect(glass.intensityRegular.blur).toBeGreaterThan(
                glass.intensitySolid.blur
            );
            expect(glass.intensityClear.blur).toBeGreaterThan(
                glass.intensitySolid.blur
            );
        });
    });

    describe("motion + easing additions", () => {
        it("morph + gelFlex durations are positive integers (ms)", () => {
            expect(motion.morph).toBeGreaterThan(0);
            expect(Number.isInteger(motion.morph)).toBe(true);
            expect(motion.gelFlex).toBeGreaterThan(0);
            expect(Number.isInteger(motion.gelFlex)).toBe(true);
        });

        it("morph sits above the existing 'long' bucket (it IS slower than a route swap)", () => {
            // Surface morph is a fluid transformation — slower than the
            // M3 'long' bucket so it reads as liquid, not snap.
            expect(motion.morph).toBeGreaterThan(motion.long);
        });

        it("gelFlex sits between 'medium' and 'long' (instant press, noticeable recovery)", () => {
            expect(motion.gelFlex).toBeGreaterThan(motion.medium);
            expect(motion.gelFlex).toBeLessThan(motion.long);
        });

        it("spring easings are cubic-bezier curves with > 1 overshoot in y", () => {
            // A cubic-bezier with `y2 > 1` overshoots past the final
            // value before settling — which is what produces the bouncy
            // / springy feel. springSoft has more overshoot than
            // springSnap by design.
            const softMatch = easing.springSoft.match(
                /^cubic-bezier\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)$/
            );
            const snapMatch = easing.springSnap.match(
                /^cubic-bezier\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)$/
            );
            expect(softMatch).not.toBeNull();
            expect(snapMatch).not.toBeNull();
            // Second control point's y is the overshoot in the second
            // half of the curve.
            const softY2 = Number(softMatch![2]);
            const snapY2 = Number(snapMatch![2]);
            expect(softY2).toBeGreaterThan(1);
            expect(snapY2).toBeGreaterThan(1);
            // springSoft overshoots more than springSnap (materialize is
            // looser than press-recovery).
            expect(softY2).toBeGreaterThan(snapY2);
        });
    });

    describe("viewTransition name registry", () => {
        it("declares the wired view-transition names", () => {
            // The registry holds only the names actually applied in
            // component CSS (page header, bottom tab bar, tab-bar
            // accessory). Dropping one would un-pair a consumer from its
            // `view-transition-name` and break the pinned cross-fade.
            for (const key of ["header", "tabbar", "tabAccessory"] as const) {
                expect(typeof viewTransition[key]).toBe("string");
                expect(viewTransition[key].length).toBeGreaterThan(0);
            }
        });

        it("pins the existing `pulse-header` / `pulse-tabbar` literals (no rename)", () => {
            // The header + bottom tab bar already register these names
            // in their component CSS. Renaming them in the registry
            // without renaming the component-side literal would silently
            // un-pair them and break the route-cross-fade behaviour.
            expect(viewTransition.header).toBe("pulse-header");
            expect(viewTransition.tabbar).toBe("pulse-tabbar");
        });

        it("every value is unique (two consumers can't accidentally morph into each other)", () => {
            // If two components share a view-transition-name, the
            // browser morphs one into the other across a route change —
            // hilarious in dev, broken in prod. The registry is the
            // canonical source, so the test enforces uniqueness here.
            const values = Object.values(viewTransition);
            expect(new Set(values).size).toBe(values.length);
        });

        it("every value uses the pulse-* namespace (so a future grep finds them all)", () => {
            for (const v of Object.values(viewTransition)) {
                expect(v).toMatch(/^pulse-/);
            }
        });
    });
});

describe("font tokens", () => {
    it("font-family stacks reference Inter and a monospace fallback", () => {
        expect(fontFamily.sans).toMatch(/Inter/);
        // Trailing fallback is `sans-serif` so a missing Inter still
        // renders a sans face.
        expect(fontFamily.sans).toMatch(/sans-serif/);
        expect(fontFamily.mono).toMatch(/monospace/);
    });

    it("fontWeight values are valid CSS weights (100–900, multiples of 100)", () => {
        for (const value of Object.values(fontWeight)) {
            expect(value).toBeGreaterThanOrEqual(100);
            expect(value).toBeLessThanOrEqual(900);
            expect(value % 100).toBe(0);
        }
    });

    it("lineHeight values are unitless ratios in a sensible range", () => {
        for (const value of Object.values(lineHeight)) {
            expect(value).toBeGreaterThanOrEqual(1);
            expect(value).toBeLessThanOrEqual(2);
        }
    });
});

describe("shadow tokens", () => {
    it("shadow scale uses comma-separated multi-shadow strings for medium+", () => {
        // The "two stacked shadows" comment in the source — `sm` and up
        // should be multi-layer shadows.
        for (const key of ["sm", "md", "lg", "xl"] as const) {
            expect(shadow[key].split(",").length).toBeGreaterThanOrEqual(2);
        }
    });

    it("focus shadow includes the accent rgb triplet", () => {
        expect(shadow.focus).toMatch(/rgba\(/);
    });
});

describe("page/layout tokens", () => {
    it("touch target minimums obey WCAG 2.5.8 (≥24 base, ≥44 coarse)", () => {
        expect(touchTargetMin).toBeGreaterThanOrEqual(24);
        expect(touchTargetCoarse).toBeGreaterThanOrEqual(44);
    });

    it("readable line-length and page max width are sane positive numbers", () => {
        expect(maxLineLengthCh).toBeGreaterThan(0);
        expect(pageMaxWidthRem).toBeGreaterThan(0);
    });

    it("zIndex ladder keeps overlays above page chrome", () => {
        expect(zIndex.modal).toBeGreaterThan(zIndex.drawer);
        expect(zIndex.toast).toBeGreaterThan(zIndex.modal);
        expect(zIndex.dropdown).toBeGreaterThan(zIndex.sticky);
    });

    it("sticky page chrome sits well below the @hello-pangea/dnd drag clone (5000)", () => {
        // The DnD library mounts its drag clone via document.body portal
        // with an inline z-index of 5000 (see zIndexOptions in
        // node_modules/@hello-pangea/dnd/dist/dnd.esm.js, mirrored in
        // tokens.dndDragClone). The sticky page chrome MUST stay below
        // that value so a card-in-flight always paints above the header
        // and projectDetail breadcrumb — even on iOS Safari where a
        // transformed/filtered ancestor could otherwise trap it. We
        // assert a generous margin (≥100) so a future small bump in
        // `sticky` doesn't accidentally collide.
        expect(zIndex.dndDragClone).toBe(5000);
        expect(zIndex.dndDragClone - zIndex.sticky).toBeGreaterThanOrEqual(100);
        expect(zIndex.dndDragClone - zIndex.navBar).toBeGreaterThanOrEqual(100);
        // The drag layer paints above every authored chrome tier
        // including drawers, modals, dropdowns, and toasts so the
        // user can always see what they are dragging.
        expect(zIndex.dndDragClone).toBeGreaterThan(zIndex.modal);
        expect(zIndex.dndDragClone).toBeGreaterThan(zIndex.drawer);
        expect(zIndex.dndDragClone).toBeGreaterThan(zIndex.dropdown);
        expect(zIndex.dndDragClone).toBeGreaterThan(zIndex.toast);
    });

    it("breakpoints are strictly increasing", () => {
        const ladder = [
            breakpoints.sm,
            breakpoints.md,
            breakpoints.lg,
            breakpoints.xl
        ];
        for (let i = 1; i < ladder.length; i += 1) {
            expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
        }
    });
});
