import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
    ANALYTICS_EVENTS,
    setAnalyticsSink,
    type AnalyticsSink
} from "../../constants/analytics";
import type { TriageNudge } from "../../interfaces/agent";
import { declaresTouchTarget } from "../ui/testHelpers";

import NudgeCard from "./index";

const baseNudge: TriageNudge = {
    nudge_id: "n-1",
    kind: "wip_overflow",
    project_id: "p-1",
    summary: "Three tasks have been in In Progress for 7+ days",
    target_ids: ["t-1", "t-2", "t-3"],
    severity: "warn"
};

const renderWith = (overrides: Partial<TriageNudge> = {}, props = {}) => {
    const nudge: TriageNudge = { ...baseNudge, ...overrides };
    return render(<NudgeCard nudge={nudge} {...props} />);
};

describe("NudgeCard", () => {
    let sink: jest.Mock<ReturnType<AnalyticsSink>, Parameters<AnalyticsSink>>;
    let restore: AnalyticsSink;

    beforeEach(() => {
        sink = jest.fn();
        restore = setAnalyticsSink(sink as AnalyticsSink);
    });

    afterEach(() => {
        setAnalyticsSink(restore);
    });

    it("renders the summary inside an alert region", () => {
        renderWith();
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent(
            /three tasks have been in in progress/i
        );
    });

    it("breaks long generated summary tokens instead of widening the card", () => {
        const summary =
            "https://example.com/really-long-generated-token-without-breaks-".repeat(
                4
            );
        renderWith({ summary });
        expect(screen.getByText(summary)).toHaveStyle({
            overflowWrap: "anywhere"
        });
    });

    it("tracks a nudge.viewed analytics event on mount", () => {
        renderWith();
        expect(sink).toHaveBeenCalledWith(ANALYTICS_EVENTS.NUDGE_VIEWED, {
            kind: "wip_overflow",
            id: "n-1"
        });
    });

    it("uses the kind-specific default CTA label when none is provided", () => {
        renderWith({ kind: "load_imbalance" }, { onAction: jest.fn() });
        expect(
            screen.getByRole("button", { name: /reassign/i })
        ).toBeInTheDocument();
    });

    it("falls back to 'Open' for unknown / extended kinds", () => {
        renderWith(
            { kind: "unowned_bug" as TriageNudge["kind"] },
            { onAction: jest.fn() }
        );
        expect(
            screen.getByRole("button", { name: /assign owner/i })
        ).toBeInTheDocument();
    });

    it("invokes onAction and tracks nudge.accepted when the CTA is clicked", async () => {
        const user = userEvent.setup();
        const onAction = jest.fn();
        renderWith({ kind: "stale_task" }, { onAction });

        await user.click(screen.getByRole("button", { name: /open task/i }));

        expect(onAction).toHaveBeenCalledTimes(1);
        expect(onAction.mock.calls[0][0]).toMatchObject({
            nudge_id: "n-1",
            kind: "stale_task"
        });
        expect(sink).toHaveBeenCalledWith(ANALYTICS_EVENTS.NUDGE_ACCEPTED, {
            kind: "stale_task",
            id: "n-1"
        });
    });

    it("invokes onDismiss and tracks nudge.dismissed when the dismiss link is clicked", async () => {
        const user = userEvent.setup();
        const onDismiss = jest.fn();
        renderWith({}, { onDismiss });

        const dismiss = screen.getByRole("button", { name: /dismiss/i });
        await user.click(dismiss);

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(sink).toHaveBeenCalledWith(ANALYTICS_EVENTS.NUDGE_DISMISSED, {
            kind: "wip_overflow",
            id: "n-1"
        });
    });

    it("hides the primary CTA when no onAction handler is provided", () => {
        renderWith({}, {});
        // No buttons should render when neither onAction nor onDismiss is set.
        expect(screen.queryAllByRole("button")).toHaveLength(0);
    });

    it("respects an explicit actionLabel override", () => {
        renderWith({}, { actionLabel: "Triage now", onAction: jest.fn() });
        expect(
            screen.getByRole("button", { name: /triage now/i })
        ).toBeInTheDocument();
    });

    it("wraps actions and declares mobile touch targets", () => {
        renderWith({}, { onAction: jest.fn(), onDismiss: jest.fn() });
        const row = screen.getByTestId("nudge-card-action-row");
        const rowClasses = row.className.split(/\s+/);
        expect(rowClasses).toContain("flex");
        expect(rowClasses).toContain("flex-wrap");

        const buttons = screen.getAllByRole("button");
        expect(buttons.length).toBeGreaterThan(0);
        buttons.forEach((button) => {
            expect(declaresTouchTarget(button)).toBe(true);
        });
    });
});
