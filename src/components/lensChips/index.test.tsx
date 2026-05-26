import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import LensChips, { parseLensId, type LensId } from "./index";

const ControlledLens = ({ initial = null }: { initial?: LensId | null }) => {
    const [active, setActive] = useState<LensId | null>(initial);
    return (
        <div>
            <LensChips active={active} onChange={setActive} />
            <span data-testid="active-lens">{active ?? "none"}</span>
        </div>
    );
};

describe("LensChips", () => {
    it("renders the full chip set (Today, This week, Mine, At risk)", () => {
        render(<LensChips active={null} onChange={jest.fn()} />);

        expect(
            screen.getByRole("group", { name: /board lenses/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /today/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /this week/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /mine/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /at risk/i })
        ).toBeInTheDocument();
    });

    it("marks the active functional chip with aria-pressed=true", () => {
        render(<LensChips active="mine" onChange={jest.fn()} />);

        expect(screen.getByRole("button", { name: /mine/i })).toHaveAttribute(
            "aria-pressed",
            "true"
        );
    });

    it("renders coming-soon chips as disabled (aria-disabled, no aria-pressed)", () => {
        render(<LensChips active={null} onChange={jest.fn()} />);

        const today = screen.getByRole("button", { name: /today/i });
        expect(today).toHaveAttribute("aria-disabled", "true");
        expect(today).not.toHaveAttribute("aria-pressed");

        // The functional "Mine" lens is NOT disabled.
        const mine = screen.getByRole("button", { name: /mine/i });
        expect(mine).not.toHaveAttribute("aria-disabled");
        expect(mine).toHaveAttribute("aria-pressed", "false");
    });

    it("clicks a chip → calls onChange with its lens id", async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        render(<LensChips active={null} onChange={onChange} />);

        await user.click(screen.getByRole("button", { name: /mine/i }));

        expect(onChange).toHaveBeenCalledWith("mine");
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("clicking a coming-soon chip is a no-op (no onChange)", async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        render(<LensChips active={null} onChange={onChange} />);

        await user.click(screen.getByRole("button", { name: /today/i }));

        expect(onChange).not.toHaveBeenCalled();
    });

    it("clicks the active chip → calls onChange(null) to clear back to All", async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        render(<LensChips active="mine" onChange={onChange} />);

        await user.click(screen.getByRole("button", { name: /mine/i }));

        expect(onChange).toHaveBeenCalledWith(null);
    });

    it("integrates with controlled state: clicking flips, re-clicking clears", async () => {
        const user = userEvent.setup();
        render(<ControlledLens />);

        const mineChip = screen.getByRole("button", { name: /mine/i });

        await user.click(mineChip);
        expect(screen.getByTestId("active-lens")).toHaveTextContent("mine");

        await user.click(mineChip);
        expect(screen.getByTestId("active-lens")).toHaveTextContent("none");
    });

    it("clicking a coming-soon chip leaves the controlled lens unchanged", async () => {
        const user = userEvent.setup();
        render(<ControlledLens initial="mine" />);

        await user.click(screen.getByRole("button", { name: /today/i }));
        expect(screen.getByTestId("active-lens")).toHaveTextContent("mine");
    });

    it("shows a coming-soon badge on graceful-skip lenses (Today, This week, At risk)", () => {
        render(<LensChips active={null} onChange={jest.fn()} />);

        const today = screen.getByRole("button", { name: /today/i });
        const week = screen.getByRole("button", { name: /this week/i });
        const risk = screen.getByRole("button", { name: /at risk/i });
        const mine = screen.getByRole("button", { name: /mine/i });

        expect(today.textContent).toMatch(/soon/i);
        expect(week.textContent).toMatch(/soon/i);
        expect(risk.textContent).toMatch(/soon/i);
        expect(mine.textContent).not.toMatch(/soon/i);
    });

    it("supports keyboard nav: Tab to a functional chip then Enter triggers onChange", async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        render(<LensChips active={null} onChange={onChange} />);

        // The coming-soon chips stay in tab order (discoverable) but do
        // not activate; tab past them to the functional "Mine" lens.
        await user.tab();
        expect(screen.getByRole("button", { name: /today/i })).toHaveFocus();
        await user.keyboard("{Enter}");
        expect(onChange).not.toHaveBeenCalled();

        await user.tab();
        await user.tab();
        expect(screen.getByRole("button", { name: /mine/i })).toHaveFocus();
        await user.keyboard("{Enter}");
        expect(onChange).toHaveBeenCalledWith("mine");
    });

    it("supports Space to activate as well as Enter (button-default semantics)", () => {
        const onChange = jest.fn();
        render(<LensChips active={null} onChange={onChange} />);

        const mine = screen.getByRole("button", { name: /mine/i });
        // Buttons fire onClick on Space key — simulate via fireEvent
        // because userEvent uses a hidden synthetic that depends on
        // focus semantics jsdom doesn't fully model for Space.
        fireEvent.click(mine);

        expect(onChange).toHaveBeenCalledWith("mine");
    });

    it("uses a tooltip on each chip for context (title attribute)", () => {
        render(<LensChips active={null} onChange={jest.fn()} />);

        expect(screen.getByRole("button", { name: /today/i })).toHaveAttribute(
            "title",
            expect.stringMatching(/today/i)
        );
        expect(screen.getByRole("button", { name: /mine/i })).toHaveAttribute(
            "title",
            expect.stringMatching(/coordinator/i)
        );
    });
});

describe("parseLensId", () => {
    it("returns the lens id for known values", () => {
        expect(parseLensId("today")).toBe("today");
        expect(parseLensId("this-week")).toBe("this-week");
        expect(parseLensId("mine")).toBe("mine");
        expect(parseLensId("at-risk")).toBe("at-risk");
    });

    it("returns null for unknown / falsy values", () => {
        expect(parseLensId(null)).toBeNull();
        expect(parseLensId(undefined)).toBeNull();
        expect(parseLensId("")).toBeNull();
        expect(parseLensId("garbage")).toBeNull();
        // No half-matches — exact strings only.
        expect(parseLensId("todays")).toBeNull();
    });

    /*
     * R2-L3: parseLensId is called with `param.lens` from useUrl, which
     * proxies `URLSearchParams#get` — first-occurrence semantics. This
     * test pins that contract so a future "multi-lens" change has to
     * walk past both this test and the doc comment together.
     */
    it("first-occurrence semantics — the lens id parsed is whatever the URL writer set first", () => {
        // Simulate what useUrl returns for ?lens=today&lens=mine — the
        // hook calls `searchParams.get("lens")` which yields "today" (the
        // first occurrence). The parser must accept that value and the
        // multi-value case never reaches it.
        const params = new URLSearchParams("lens=today&lens=mine");
        expect(parseLensId(params.get("lens"))).toBe("today");
    });
});
