import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";

import FilterChips, { FilterChip } from ".";

import { touchTargetCoarse } from "../../theme/tokens";

type SizeDecl = {
    media: string | null;
    prop: "min-height" | "min-width" | "height" | "width";
    value: string;
};

const collectSizeDecls = (element: HTMLElement): SizeDecl[] => {
    const classes = Array.from(element.classList);
    const out: SizeDecl[] = [];
    const sheets = Array.from(document.styleSheets);
    const matchSelector = (selector: string) =>
        classes.some((cls) => selector.includes(`.${cls}`));

    const collect = (rules: CSSRuleList | undefined, media: string | null) => {
        if (!rules) return;
        Array.from(rules).forEach((rule) => {
            if (rule instanceof CSSMediaRule) {
                collect(rule.cssRules, rule.conditionText);
                return;
            }
            if (!(rule instanceof CSSStyleRule)) return;
            if (!matchSelector(rule.selectorText)) return;
            (["min-height", "min-width", "height", "width"] as const).forEach(
                (prop) => {
                    const value = rule.style.getPropertyValue(prop);
                    if (value) {
                        out.push({ media, prop, value: value.trim() });
                    }
                }
            );
        });
    };

    sheets.forEach((sheet) => {
        try {
            collect(sheet.cssRules, null);
        } catch {
            // Cross-origin sheet — skip.
        }
    });
    return out;
};

const parsePx = (value: string): number | null => {
    const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
    if (px) return parseFloat(px[1]);
    return null;
};

const maxPxInMedia = (
    decls: SizeDecl[],
    prop: SizeDecl["prop"],
    mediaSubstr: string
): number =>
    Math.max(
        0,
        ...decls
            .filter((d) => d.media?.includes(mediaSubstr))
            .filter((d) => d.prop === prop)
            .map((d) => parsePx(d.value) ?? 0)
    );

const coarseMinTouchExtent = (
    decls: SizeDecl[],
    prop: "height" | "width" | "min-height" | "min-width"
): number => Math.max(maxPxInMedia(decls, prop, "pointer: coarse"));

describe("FilterChips", () => {
    const chips: FilterChip[] = [
        { key: "a", label: "Alpha", value: "one" },
        { key: "b", label: "Beta", value: "two" }
    ];

    it("dismiss buttons are native type=button and lift to coarse touch minimum", () => {
        render(<FilterChips chips={chips} onDismiss={() => undefined} />);
        const buttons = screen.getAllByRole("button", {
            name: /remove .* filter/i
        });
        expect(buttons).toHaveLength(2);
        buttons.forEach((btn) => {
            expect(btn).toHaveAttribute("type", "button");
            const decls = collectSizeDecls(btn as HTMLElement);
            expect(
                Math.max(
                    coarseMinTouchExtent(decls, "height"),
                    coarseMinTouchExtent(decls, "min-height")
                )
            ).toBeGreaterThanOrEqual(touchTargetCoarse);
            expect(
                Math.max(
                    coarseMinTouchExtent(decls, "width"),
                    coarseMinTouchExtent(decls, "min-width")
                )
            ).toBeGreaterThanOrEqual(touchTargetCoarse);
        });
    });

    it("Clear all is type=button and meets coarse touch minimum sizing", () => {
        render(
            <FilterChips
                chips={chips}
                onClearAll={() => undefined}
                onDismiss={() => undefined}
            />
        );
        const clear = screen.getByRole("button", { name: /clear$/i });
        expect(clear).toHaveAttribute("type", "button");
        const decls = collectSizeDecls(clear);
        expect(
            Math.max(
                coarseMinTouchExtent(decls, "height"),
                coarseMinTouchExtent(decls, "min-height")
            )
        ).toBeGreaterThanOrEqual(touchTargetCoarse);
        expect(
            Math.max(
                coarseMinTouchExtent(decls, "width"),
                coarseMinTouchExtent(decls, "min-width")
            )
        ).toBeGreaterThanOrEqual(touchTargetCoarse);
    });

    it("keeps dismiss hit area compact on fine pointers", () => {
        render(<FilterChips chips={[chips[0]]} onDismiss={() => undefined} />);
        const btn = screen.getByRole("button", { name: /remove .* filter/i });
        const decls = collectSizeDecls(btn);
        const baseline = Math.max(
            ...decls
                .filter((d) => d.media === null)
                .filter((d) => d.prop === "height" || d.prop === "width")
                .map((d) => parsePx(d.value) ?? 0)
        );
        expect(baseline).toBeLessThanOrEqual(20);
    });
});
