import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
    ANALYTICS_EVENTS,
    setAnalyticsSink,
    type AnalyticsSink
} from "../../constants/analytics";
import {
    coarseTouchTargetsFor,
    ruleTextsFor,
    styledClassFor
} from "../../testUtils/styleRules";

import AiCopilotSurfaceFeedback from "./copilotSurfaceFeedback";

describe("AiCopilotSurfaceFeedback", () => {
    let sink: jest.Mock<ReturnType<AnalyticsSink>, Parameters<AnalyticsSink>>;
    let restore: AnalyticsSink;

    beforeEach(() => {
        sink = jest.fn();
        restore = setAnalyticsSink(sink as AnalyticsSink);
    });

    afterEach(() => {
        setAnalyticsSink(restore);
    });

    it("renders nothing when suggestionKey is empty", () => {
        const { container } = render(
            <AiCopilotSurfaceFeedback
                ariaGroupLabel="Rate suggestion"
                surface="task-assist"
                suggestionKey=""
            />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it("emits THUMBS_FEEDBACK with up + surface metadata on thumbs-up", async () => {
        const user = userEvent.setup();
        render(
            <AiCopilotSurfaceFeedback
                ariaGroupLabel="Rate suggestion"
                citationCount={3}
                surface="board-brief"
                suggestionKey="sugg-1"
            />
        );

        const up = screen.getByRole("button", { name: /helpful answer/i });
        await user.click(up);

        expect(sink).toHaveBeenCalledWith(
            ANALYTICS_EVENTS.THUMBS_FEEDBACK,
            expect.objectContaining({
                value: "up",
                surface: "board-brief",
                suggestionId: "sugg-1",
                citationCount: 3
            })
        );
        // Subsequent click on the same thumbs-up is a no-op (already chosen).
        sink.mockClear();
        await user.click(up);
        expect(sink).not.toHaveBeenCalled();
    });

    it("opens the popover when thumbs-down is pressed and exposes aria-expanded", async () => {
        const user = userEvent.setup();
        render(
            <AiCopilotSurfaceFeedback
                ariaGroupLabel="Rate suggestion"
                surface="task-assist"
                suggestionKey="sugg-2"
            />
        );

        const down = screen.getByRole("button", {
            name: /not helpful — give feedback/i
        });
        expect(down).toHaveAttribute("aria-expanded", "false");
        await user.click(down);
        expect(down).toHaveAttribute("aria-expanded", "true");
    });

    it("renders the feedback controls as a wrapping rail with mobile touch targets", () => {
        render(
            <AiCopilotSurfaceFeedback
                ariaGroupLabel="Rate suggestion"
                surface="task-assist"
                suggestionKey="sugg-rail"
            />
        );

        const group = screen.getByRole("group", { name: /rate suggestion/i });
        const styledClass = styledClassFor(group);
        expect(styledClass).toBeTruthy();

        const ruleText = ruleTextsFor(styledClass ?? "").join("\n");
        expect(ruleText).toContain("display: inline-flex");
        expect(ruleText).toContain("flex-wrap: wrap");
        const { heights, widths } = coarseTouchTargetsFor(styledClass ?? "");
        expect(Math.max(...heights)).toBeGreaterThanOrEqual(44);
        expect(Math.max(...widths)).toBeGreaterThanOrEqual(44);
    });

    it("emits a 'down' analytics event with selected categories when feedback is submitted", async () => {
        const user = userEvent.setup();
        render(
            <AiCopilotSurfaceFeedback
                ariaGroupLabel="Rate suggestion"
                surface="task-assist"
                suggestionKey="sugg-3"
            />
        );

        await user.click(
            screen.getByRole("button", {
                name: /not helpful — give feedback/i
            })
        );
        const firstCategory = screen.getAllByRole("checkbox")[0];
        await user.click(firstCategory);
        await user.click(
            screen.getByRole("button", { name: /send feedback/i })
        );

        expect(sink).toHaveBeenCalledWith(
            ANALYTICS_EVENTS.THUMBS_FEEDBACK,
            expect.objectContaining({
                value: "down",
                surface: "task-assist",
                suggestionId: "sugg-3",
                hasNote: false
            })
        );
    });

    it("re-fires analytics for the same surface when the suggestionKey changes", async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <AiCopilotSurfaceFeedback
                ariaGroupLabel="Rate suggestion"
                surface="task-assist"
                suggestionKey="sugg-A"
            />
        );

        await user.click(
            screen.getByRole("button", { name: /helpful answer/i })
        );
        expect(sink).toHaveBeenCalledWith(
            ANALYTICS_EVENTS.THUMBS_FEEDBACK,
            expect.objectContaining({
                value: "up",
                suggestionId: "sugg-A"
            })
        );

        // Same component, different suggestion — the previous selection
        // should reset so the user can re-rate the new suggestion.
        sink.mockClear();
        rerender(
            <AiCopilotSurfaceFeedback
                ariaGroupLabel="Rate suggestion"
                surface="task-assist"
                suggestionKey="sugg-B"
            />
        );

        await user.click(
            screen.getByRole("button", { name: /helpful answer/i })
        );
        expect(sink).toHaveBeenCalledWith(
            ANALYTICS_EVENTS.THUMBS_FEEDBACK,
            expect.objectContaining({
                value: "up",
                suggestionId: "sugg-B"
            })
        );
    });
});
