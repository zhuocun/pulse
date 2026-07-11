import { fireEvent, render, screen } from "@testing-library/react";

import { microcopy } from "../../constants/microcopy";
import type { CitationRef } from "../../interfaces/agent";
import CitationChip from ".";

describe("CitationChip", () => {
    it("labels backend user citations as User", () => {
        const citation: CitationRef = {
            source: "user",
            id: "u1",
            quote: "Alice created the task"
        };

        render(<CitationChip citation={citation} index={1} />);

        expect(
            screen.getByLabelText("Citation 1: User u1")
        ).toBeInTheDocument();
    });

    it("exposes a non-navigable chip as a single labeled image, not an aside note", () => {
        const citation: CitationRef = {
            source: "user",
            id: "u1",
            quote: "Alice created the task"
        };

        render(<CitationChip citation={citation} index={1} />);

        expect(
            screen.getByRole("img", { name: "Citation 1: User u1" })
        ).toBeInTheDocument();
        expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });

    it("exposes a navigable chip as a button", () => {
        const citation: CitationRef = {
            source: "task",
            id: "t-7",
            quote: "Switch to TanStack Query for board fetches."
        };

        render(
            <CitationChip
                citation={citation}
                index={2}
                onNavigate={jest.fn()}
            />
        );

        expect(
            screen.getByRole("button", { name: "Citation 2: Task t-7" })
        ).toBeInTheDocument();
    });

    /*
     * QW#7 (2026-05 review §Quick Wins): the citation overlay is now a
     * Popover with a click trigger, not a hover Tooltip. The body still
     * surfaces the source, the verbatim quote, and the "report wrong
     * source" affordance — but reaching it no longer requires a mouse
     * (and the flag Button is now keyboard-focusable inside the open
     * popover).
     */
    it("opens the source preview popover on click and surfaces the verbatim quote + flag affordance", () => {
        const citation: CitationRef = {
            source: "task",
            id: "t-7",
            quote: "Switch to TanStack Query for board fetches."
        };

        render(<CitationChip citation={citation} index={3} />);

        // The body is not in the DOM before the user activates the chip.
        expect(
            screen.queryByText(/Switch to TanStack Query/i)
        ).not.toBeInTheDocument();

        // Click the chip — the popover opens with the quote + flag button.
        fireEvent.click(screen.getByLabelText("Citation 3: Task t-7"));
        expect(
            screen.getByText(/Switch to TanStack Query/i)
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", {
                name: microcopy.ai.citationFlagAction as string
            })
        ).toBeInTheDocument();
    });
});
