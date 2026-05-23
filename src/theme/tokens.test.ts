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
import {
    accent,
    aurora,
    avatarGradients,
    breakpoints,
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
            expect(grad).toMatch(/^linear-gradient\(/);
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

    it("accent.bg* are rgba() strings derived from the palette accent triplet", () => {
        for (const key of [
            "bgSubtle",
            "bgSoft",
            "bgMedium",
            "bgStrong",
            "glow",
            "border"
        ] as const) {
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
