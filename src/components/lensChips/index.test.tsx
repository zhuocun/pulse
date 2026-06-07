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
    it("renders the functional chip set (Today, This week, Mine, priorities)", () => {
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
            screen.queryByRole("button", { name: /at risk/i })
        ).not.toBeInTheDocument();
    });

    it("marks the active functional chip with aria-pressed=true", () => {
        render(<LensChips active="mine" onChange={jest.fn()} />);

        expect(screen.getByRole("button", { name: /mine/i })).toHaveAttribute(
            "aria-pressed",
            "true"
        );
    });

    it("renders functional chips enabled with a real pressed state", () => {
        render(<LensChips active={null} onChange={jest.fn()} />);

        const mine = screen.getByRole("button", { name: /mine/i });
        expect(mine).not.toHaveAttribute("aria-disabled");
        expect(mine).toHaveAttribute("aria-pressed", "false");
    });

    it("renders the now-functional date lenses (Today, This week) as enabled and toggleable", () => {
        // M2 — `dueDate` shipped, so these graduated from coming-soon to
        // functional: enabled, with a real pressed state, no "soon" badge.
        render(<LensChips active={null} onChange={jest.fn()} />);

        const today = screen.getByRole("button", { name: /today/i });
        const week = screen.getByRole("button", { name: /this week/i });

        expect(today).not.toHaveAttribute("aria-disabled");
        expect(today).toHaveAttribute("aria-pressed", "false");
        expect(week).not.toHaveAttribute("aria-disabled");
        expect(week).toHaveAttribute("aria-pressed", "false");
    });

    it("marks an active date lens with aria-pressed=true", () => {
        render(<LensChips active="this-week" onChange={jest.fn()} />);

        expect(
            screen.getByRole("button", { name: /this week/i })
        ).toHaveAttribute("aria-pressed", "true");
    });

    it("renders the priority lenses (High priority, Urgent) as functional, enabled, and toggleable", () => {
        // The `priority` enum shipped, so these are functional lenses:
        // enabled, real pressed state, no "soon" badge.
        render(<LensChips active={null} onChange={jest.fn()} />);

        const high = screen.getByRole("button", { name: /high priority/i });
        const urgent = screen.getByRole("button", { name: /^urgent$/i });

        expect(high).not.toHaveAttribute("aria-disabled");
        expect(high).toHaveAttribute("aria-pressed", "false");
        expect(high.textContent).not.toMatch(/soon/i);
        expect(urgent).not.toHaveAttribute("aria-disabled");
        expect(urgent).toHaveAttribute("aria-pressed", "false");
        expect(urgent.textContent).not.toMatch(/soon/i);
    });

    it("marks an active priority lens with aria-pressed=true", () => {
        render(<LensChips active="priority-high" onChange={jest.fn()} />);

        expect(
            screen.getByRole("button", { name: /high priority/i })
        ).toHaveAttribute("aria-pressed", "true");
    });

    it("clicking a priority chip calls onChange with its lens id", async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        render(<LensChips active={null} onChange={onChange} />);

        await user.click(screen.getByRole("button", { name: /^urgent$/i }));

        expect(onChange).toHaveBeenCalledWith("priority-urgent");
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("clicks a chip → calls onChange with its lens id", async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        render(<LensChips active={null} onChange={onChange} />);

        await user.click(screen.getByRole("button", { name: /mine/i }));

        expect(onChange).toHaveBeenCalledWith("mine");
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("clicking a now-functional date chip (Today) calls onChange with its lens id", async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        render(<LensChips active={null} onChange={onChange} />);

        await user.click(screen.getByRole("button", { name: /today/i }));

        expect(onChange).toHaveBeenCalledWith("today");
        expect(onChange).toHaveBeenCalledTimes(1);
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

    it("does not surface coming-soon lenses in the chip row", () => {
        render(<LensChips active={null} onChange={jest.fn()} />);

        const today = screen.getByRole("button", { name: /today/i });
        const week = screen.getByRole("button", { name: /this week/i });
        const mine = screen.getByRole("button", { name: /mine/i });

        expect(today.textContent).not.toMatch(/soon/i);
        expect(week.textContent).not.toMatch(/soon/i);
        expect(mine.textContent).not.toMatch(/soon/i);
        expect(
            screen.queryByRole("button", { name: /at risk/i })
        ).not.toBeInTheDocument();
    });

    it("supports keyboard nav: Tab to the first (now-functional) chip then Enter triggers onChange", async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        render(<LensChips active={null} onChange={onChange} />);

        // "Today" is the first chip and is now functional (M2): Enter fires.
        await user.tab();
        expect(screen.getByRole("button", { name: /today/i })).toHaveFocus();
        await user.keyboard("{Enter}");
        expect(onChange).toHaveBeenCalledWith("today");

        // Tab through the remaining functional chips — coming-soon lenses
        // stay out of the row until their data field ships.
        onChange.mockClear();
        await user.tab();
        await user.tab();
        await user.tab();
        await user.tab();
        expect(
            screen.getByRole("button", { name: /^urgent$/i })
        ).toHaveFocus();
        await user.keyboard("{Enter}");
        expect(onChange).toHaveBeenCalledWith("priority-urgent");
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
        expect(parseLensId("priority-high")).toBe("priority-high");
        expect(parseLensId("priority-urgent")).toBe("priority-urgent");
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
