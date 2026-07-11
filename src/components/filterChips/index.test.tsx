import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { declaresTouchTarget } from "../ui/testHelpers";

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

    // WCAG 2.5.8 (Target Size, Minimum). The per-chip dismiss control and the
    // "Clear all" text button both sit below the 44 px AAA target on fine
    // pointers, so each lifts to the canonical `coarse:min-h-[44px]` floor.
    // Assert the utility is present on both filter affordances so a refactor
    // that drops either below 44 must fail CI.
    it("declares a touch-target height of at least 44 px on the filter affordances (WCAG 2.5.8)", () => {
        render(
            <FilterChips
                chips={chips}
                onClearAll={jest.fn()}
                onDismiss={jest.fn()}
            />
        );

        const clearAll = screen.getByRole("button", { name: /^clear$/i });
        const dismiss = screen.getByRole("button", {
            name: /remove manager filter/i
        });

        expect(declaresTouchTarget(clearAll)).toBe(true);
        expect(declaresTouchTarget(dismiss)).toBe(true);
    });
});
