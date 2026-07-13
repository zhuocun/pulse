import { labelTagProps } from "./labelTagColor";

describe("labelTagProps", () => {
    it("returns empty props when colour is missing", () => {
        expect(labelTagProps()).toEqual({});
        expect(labelTagProps(null)).toEqual({});
        expect(labelTagProps("")).toEqual({});
    });

    it("passes named colours through for theme-aware Tag presets", () => {
        expect(labelTagProps("blue")).toEqual({ color: "blue" });
    });

    it("derives light-dark fill, border, and ink for hex labels", () => {
        const { style } = labelTagProps("#2f54eb");
        expect(style?.color).toContain("light-dark(#2f54eb");
        expect(style?.color).toContain("color-mix(in srgb, #2f54eb 55%, white)");
        expect(style?.backgroundColor).toContain("light-dark(");
        expect(style?.backgroundColor).toContain(
            "color-mix(in srgb, #2f54eb 18%, transparent)"
        );
        expect(style?.backgroundColor).toContain(
            "color-mix(in srgb, #2f54eb 32%, transparent)"
        );
    });
});
