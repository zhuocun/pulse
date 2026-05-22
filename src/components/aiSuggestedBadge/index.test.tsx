import { fireEvent, render, screen } from "@testing-library/react";

import { microcopy } from "../../constants/microcopy";
import AiSuggestedBadge from "./index";

describe("AiSuggestedBadge", () => {
    it("renders the full label by default", () => {
        render(<AiSuggestedBadge />);
        expect(
            screen.getByText(microcopy.ai.appliedSuggestion)
        ).toBeInTheDocument();
    });

    it("renders the compact label in dense layouts", () => {
        render(<AiSuggestedBadge compact />);
        expect(
            screen.getByText(microcopy.ai.appliedSuggestionShort)
        ).toBeInTheDocument();
    });

    it("opens a popover on click and exposes the revert affordance", () => {
        const onRevert = jest.fn();
        render(<AiSuggestedBadge onRevert={onRevert} />);
        const badge = screen.getByRole("button", {
            name: microcopy.ai.appliedSuggestion
        });
        fireEvent.click(badge);
        const revert = screen.getByText(microcopy.ai.revertToPrevious);
        fireEvent.click(revert);
        expect(onRevert).toHaveBeenCalledTimes(1);
    });

    it("falls back to the generic suggestionPopover copy when no rationale is provided", () => {
        render(<AiSuggestedBadge />);
        const badge = screen.getByRole("button", {
            name: microcopy.ai.appliedSuggestion
        });
        fireEvent.click(badge);
        expect(
            screen.getByText(microcopy.ai.suggestionPopover)
        ).toBeInTheDocument();
    });

    it("does not open the popover when the badge merely gains focus", () => {
        // Regression guard: the popover used to fire on `focus`, which
        // narrated the rationale into screen-reader output mid-form-fill
        // as users tabbed through adjacent badges. With `"focus"` dropped
        // from the trigger list, focus alone is a no-op; the user must
        // click (or press Enter/Space) to open the popover.
        render(<AiSuggestedBadge />);
        const badge = screen.getByRole("button", {
            name: microcopy.ai.appliedSuggestion
        });
        badge.focus();
        fireEvent.focus(badge);
        expect(
            screen.queryByText(microcopy.ai.suggestionPopover)
        ).not.toBeInTheDocument();
    });

    it("still opens the popover on click", () => {
        render(<AiSuggestedBadge />);
        const badge = screen.getByRole("button", {
            name: microcopy.ai.appliedSuggestion
        });
        fireEvent.click(badge);
        expect(
            screen.getByText(microcopy.ai.suggestionPopover)
        ).toBeInTheDocument();
    });
});
