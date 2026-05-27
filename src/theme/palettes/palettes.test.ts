/**
 * Structural tests for the palette catalogue.
 *
 * The `Palette` type enforces shape at compile time, but two runtime
 * details aren't reachable from the type system:
 *
 *  1. The `rgb` / `rgbDark` triplets must be the literal "R, G, B" form
 *     so they can drop into `rgba(${triplet}, alpha)` template strings.
 *     A regression to "rgb(R, G, B)" or "R G B" would produce invalid
 *     CSS at runtime.
 *  2. The `avatarGradients` tuple is typed as 6 entries — but `as const`
 *     is enough to widen back to `string[]` if someone removes the
 *     literal. The test asserts the length so the tuple stays a tuple.
 *
 * Both shipped palettes are exercised so a new palette added later
 * can't regress on either invariant.
 */
import { bluePalette } from "./blue";
import { emeraldPalette } from "./emerald";
import { orangePalette } from "./orange";
import type { Palette } from "./types";

const RGB_TRIPLET = /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

const palettes: ReadonlyArray<[string, Palette]> = [
    ["blue", bluePalette],
    ["emerald", emeraldPalette],
    ["orange", orangePalette]
];

describe.each(palettes)("palette: %s", (name, palette) => {
    describe("identity", () => {
        it("declares the matching name", () => {
            expect(palette.name).toBe(name);
        });
    });

    describe("brand", () => {
        const colorKeys = [
            "primary",
            "primaryHover",
            "primaryActive",
            "primaryBg",
            "primaryBgDark",
            "primaryDark"
        ] as const;

        it.each(colorKeys)("%s is a hex color", (key) => {
            expect(palette.brand[key]).toMatch(HEX_COLOR);
        });
    });

    describe("accent", () => {
        it("start/end are hex colors", () => {
            expect(palette.accent.start).toMatch(HEX_COLOR);
            expect(palette.accent.end).toMatch(HEX_COLOR);
        });

        it("rgb is the literal 'R, G, B' form ready for rgba() interpolation", () => {
            expect(palette.accent.rgb).toMatch(RGB_TRIPLET);
            expect(palette.accent.rgbDark).toMatch(RGB_TRIPLET);
        });

        it("each rgb component is within the 0–255 range", () => {
            for (const triplet of [
                palette.accent.rgb,
                palette.accent.rgbDark
            ]) {
                const parts = triplet.split(",").map((s) => Number(s.trim()));
                expect(parts).toHaveLength(3);
                for (const v of parts) {
                    expect(Number.isFinite(v)).toBe(true);
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(255);
                }
            }
        });
    });

    describe("aurora", () => {
        const auroraKeys = ["deep", "mid", "light", "cinematicBase"] as const;
        it.each(auroraKeys)("%s is a hex color", (key) => {
            expect(palette.aurora[key]).toMatch(HEX_COLOR);
        });
    });

    describe("page", () => {
        it("bgLight / bgDark are hex colors", () => {
            expect(palette.page.bgLight).toMatch(HEX_COLOR);
            expect(palette.page.bgDark).toMatch(HEX_COLOR);
        });

        it("textLight / textDark are rgba() strings", () => {
            expect(palette.page.textLight).toMatch(/^rgba\(/);
            expect(palette.page.textDark).toMatch(/^rgba\(/);
        });
    });

    describe("avatarGradients", () => {
        it("is a tuple of exactly 6 entries", () => {
            expect(palette.avatarGradients).toHaveLength(6);
        });

        it("every entry is a linear-gradient() string", () => {
            for (const grad of palette.avatarGradients) {
                expect(grad).toMatch(/^linear-gradient\(135deg,/);
            }
        });

        it("entries are distinct (so two adjacent ids don't collide)", () => {
            const unique = new Set(palette.avatarGradients);
            expect(unique.size).toBe(palette.avatarGradients.length);
        });
    });
});

describe("palette catalogue", () => {
    it("active palette (orange) is the one exported by ./index", () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { palette: active } = require("./index") as { palette: Palette };
        expect(active).toBe(orangePalette);
    });
});
