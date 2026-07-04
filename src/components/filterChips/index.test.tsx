import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FilterChips, { type FilterChip } from "./index";

const chips: FilterChip[] = [
    { key: "manager", label: "Manager", value: "Alice" },
    { key: "type", label: "Type", value: "Task" }
];

describe("FilterChips", () => {
    it("renders nothing when there are no active chips", () => {
        const { container } = render(
            <FilterChips chips={[]} onDismiss={jest.fn()} />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it("renders the active-filters region with each chip label/value pair", () => {
        render(<FilterChips chips={chips} onDismiss={jest.fn()} />);

        const region = screen.getByRole("region", { name: /active filters/i });
        expect(region).toBeInTheDocument();
        expect(region).toHaveTextContent(/Manager:/);
        expect(region).toHaveTextContent("Alice");
        expect(region).toHaveTextContent(/Type:/);
        expect(region).toHaveTextContent("Task");
    });

    it("calls onDismiss with the chip key when its remove button is pressed", async () => {
        const user = userEvent.setup();
        const onDismiss = jest.fn();
        render(<FilterChips chips={chips} onDismiss={onDismiss} />);

        await user.click(
            screen.getByRole("button", { name: /remove manager filter/i })
        );
        expect(onDismiss).toHaveBeenCalledWith("manager");
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("hides the clear-all CTA when only one chip is active", () => {
        render(
            <FilterChips
                chips={[chips[0]]}
                onClearAll={jest.fn()}
                onDismiss={jest.fn()}
            />
        );
        expect(
            screen.queryByRole("button", { name: /^clear$/i })
        ).not.toBeInTheDocument();
    });

    it("shows the clear-all CTA only when 2+ chips are active and onClearAll is provided", async () => {
        const user = userEvent.setup();
        const onClearAll = jest.fn();
        render(
            <FilterChips
                chips={chips}
                onClearAll={onClearAll}
                onDismiss={jest.fn()}
            />
        );

        const clearAll = screen.getByRole("button", { name: /^clear$/i });
        await user.click(clearAll);
        expect(onClearAll).toHaveBeenCalledTimes(1);
    });

    it("omits the clear-all CTA when onClearAll is undefined even with multiple chips", () => {
        render(<FilterChips chips={chips} onDismiss={jest.fn()} />);
        expect(
            screen.queryByRole("button", { name: /^clear$/i })
        ).not.toBeInTheDocument();
    });

    it("honours an explicit clearAllLabel override", () => {
        render(
            <FilterChips
                chips={chips}
                clearAllLabel="Reset all"
                onClearAll={jest.fn()}
                onDismiss={jest.fn()}
            />
        );
        expect(
            screen.getByRole("button", { name: /reset all/i })
        ).toBeInTheDocument();
    });

    // WCAG 2.5.8 (Target Size, Minimum). The "Clear all" text button sits at
    // ~22 px tall by default — below the 44 px AAA target — so it lifts to
    // `min-height: 44px` under `@media (pointer: coarse)`, matching the
    // sibling per-chip dismiss control. Walk the rendered stylesheet (same
    // approach as `projectCard.test.tsx`) and assert the 44 px declaration is
    // emitted on both filter affordances, so a refactor that drops either
    // below 44 must fail CI.
    it("declares a touch-target height of at least 44 px on the filter affordances (WCAG 2.5.8)", () => {
        render(
            <FilterChips
                chips={chips}
                onClearAll={jest.fn()}
                onDismiss={jest.fn()}
            />
        );

        const isEmotionToken = (tok: string) =>
            /^css-[a-z0-9]{4,}$/i.test(tok) &&
            !tok.startsWith("css-var-") &&
            !tok.startsWith("css-dev-only-");
        const styledClassFor = (el: HTMLElement): string | undefined => {
            let node: HTMLElement | null = el;
            while (node) {
                const tok = node.className
                    ?.toString()
                    .split(/\s+/)
                    .find(isEmotionToken);
                if (tok) return tok;
                node = node.parentElement;
            }
            return undefined;
        };

        const heightsFor = (styledCls: string): number[] => {
            const heights: number[] = [];
            const visit = (rule: CSSRule) => {
                if (rule instanceof CSSStyleRule) {
                    if (!rule.selectorText.includes(styledCls)) return;
                    const re =
                        /(?:^|[\s;{])(?:min-)?height:\s*(\d+(?:\.\d+)?)px/gi;
                    let m: RegExpExecArray | null = re.exec(rule.cssText);
                    while (m !== null) {
                        heights.push(parseFloat(m[1] ?? "0"));
                        m = re.exec(rule.cssText);
                    }
                } else if ("cssRules" in rule) {
                    for (const child of Array.from(
                        (rule as CSSGroupingRule).cssRules
                    )) {
                        visit(child);
                    }
                }
            };
            Array.from(document.styleSheets).forEach((sheet) => {
                let rules: CSSRuleList;
                try {
                    rules = sheet.cssRules;
                } catch {
                    return;
                }
                for (const rule of Array.from(rules)) visit(rule);
            });
            return heights;
        };

        const clearAll = screen.getByRole("button", { name: /^clear$/i });
        const dismiss = screen.getByRole("button", {
            name: /remove manager filter/i
        });
        const clearAllCls = styledClassFor(clearAll);
        const dismissCls = styledClassFor(dismiss);
        expect(clearAllCls).toBeTruthy();
        expect(dismissCls).toBeTruthy();

        expect(heightsFor(clearAllCls as string)).toContain(44);
        expect(heightsFor(dismissCls as string)).toContain(44);
    });
});
