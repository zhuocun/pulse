import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import {
    ANALYTICS_EVENTS,
    setAnalyticsSink,
    type AnalyticsSink
} from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import type { MutationProposal } from "../../interfaces/agent";

import MutationProposalCard from ".";

expect.extend(toHaveNoViolations);

/**
 * Drive the 10-second post-accept countdown to zero by flushing fake
 * timers in 1-second increments inside `act()`. Each timer firing both
 * decrements the countdown state AND triggers a re-render that schedules
 * the next setTimeout, so we have to advance one tick at a time.
 */
const flushAcceptCountdown = () => {
    for (let i = 0; i < 11; i += 1) {
        act(() => {
            jest.advanceTimersByTime(1000);
        });
    }
};

const baseProposal: MutationProposal = {
    proposal_id: "p-1",
    description: "Reassign two unowned bugs to Alice",
    risk: "low",
    undoable: true,
    diff: {
        task_updates: [
            {
                task_id: "t-1",
                field: "coordinatorId",
                from: "m-unassigned",
                to: "m-alice"
            }
        ]
    }
};

describe("MutationProposalCard", () => {
    let sink: jest.MockedFunction<AnalyticsSink>;
    let restoreSink: AnalyticsSink;

    beforeEach(() => {
        sink = jest.fn();
        restoreSink = setAnalyticsSink(sink);
    });

    afterEach(() => {
        setAnalyticsSink(restoreSink);
    });

    it("renders the diff plus accept/reject without an Undo CTA when no onUndo is provided", () => {
        render(
            <MutationProposalCard
                onAccept={jest.fn()}
                onReject={jest.fn()}
                proposal={baseProposal}
            />
        );
        expect(
            screen.getByText(/Reassign two unowned bugs/)
        ).toBeInTheDocument();
        // The "Undoable" tag still renders (it's metadata on the proposal),
        // but no Undo button should exist when callers haven't opted in.
        expect(screen.getByText("Undoable")).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: /Undo this proposal/i })
        ).not.toBeInTheDocument();
    });

    it("does NOT render the post-commit Undo button in the idle phase (the footer hint promises it AFTER accept — Bug 2)", () => {
        render(
            <MutationProposalCard
                onAccept={jest.fn()}
                onReject={jest.fn()}
                onUndo={jest.fn()}
                proposal={baseProposal}
            />
        );

        // In the idle phase the only buttons are Cancel + Apply. The
        // post-commit Undo CTA waits for the user to actually accept.
        expect(
            screen.queryByRole("button", { name: /Undo this proposal/i })
        ).not.toBeInTheDocument();
        // The footer hint still promises Undo after accepting, so we know
        // we're in the right phase.
        expect(
            screen.getByText(microcopy.mutation.undoAvailableAfterAccepting)
        ).toBeInTheDocument();
    });

    it("surfaces the Undo button in the committed phase (after Accept + 10s countdown) and fires AGENT_PROPOSAL_UNDONE on click — Bug 2", () => {
        jest.useFakeTimers();
        try {
            const onUndo = jest.fn();
            const onAccept = jest.fn();
            render(
                <MutationProposalCard
                    onAccept={onAccept}
                    onReject={jest.fn()}
                    onUndo={onUndo}
                    proposal={baseProposal}
                />
            );

            // The Undo button is NOT visible while the card is idle.
            expect(
                screen.queryByRole("button", { name: /Undo this proposal/i })
            ).not.toBeInTheDocument();

            // Click Accept → enters the 10s countdown phase. The Apply CTA
            // is gone (countdown UI takes over) and the post-commit Undo
            // button is still not visible (we're in `countdown`, not yet
            // `committed`).
            fireEvent.click(
                screen.getByRole("button", {
                    name: microcopy.a11y.acceptProposal as string
                })
            );
            expect(
                screen.queryByRole("button", { name: /Undo this proposal/i })
            ).not.toBeInTheDocument();

            // Run the countdown to completion — onAccept fires and the
            // card transitions to the committed phase.
            flushAcceptCountdown();
            expect(onAccept).toHaveBeenCalledTimes(1);

            // The post-commit Undo button is now visible in the committed
            // phase. Clicking it delegates to onUndo and fires analytics.
            const undoBtn = screen.getByRole("button", {
                name: /Undo this proposal/i
            });
            expect(undoBtn).toBeInTheDocument();

            fireEvent.click(undoBtn);

            expect(onUndo).toHaveBeenCalledTimes(1);
            expect(sink).toHaveBeenCalledWith(
                ANALYTICS_EVENTS.AGENT_PROPOSAL_UNDONE,
                expect.objectContaining({ id: "p-1", risk: "low" })
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it("hides the post-commit Undo CTA when proposal.undoable is false even after a full Accept → committed transition", () => {
        // The shipped MutationProposal type pins `undoable: true` at the
        // schema level, but at runtime the BE could narrow the field —
        // guard the FE-side render so a future "non-undoable" proposal
        // doesn't surface a button that would be a guaranteed no-op.
        jest.useFakeTimers();
        try {
            const proposal = {
                ...baseProposal,
                // Cast through unknown so the test can probe the runtime
                // contract without fighting the literal `true` type.
                undoable: false as unknown as true
            };
            render(
                <MutationProposalCard
                    onAccept={jest.fn()}
                    onReject={jest.fn()}
                    onUndo={jest.fn()}
                    proposal={proposal}
                />
            );
            // Idle phase: no Undo affordance.
            expect(
                screen.queryByRole("button", { name: /Undo this proposal/i })
            ).not.toBeInTheDocument();

            // Even after Accept + countdown, the committed phase doesn't
            // surface an Undo CTA when undoable === false.
            fireEvent.click(
                screen.getByRole("button", {
                    name: microcopy.a11y.acceptProposal as string
                })
            );
            flushAcceptCountdown();
            expect(
                screen.queryByRole("button", { name: /Undo this proposal/i })
            ).not.toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it("has no axe-detectable a11y violations in the idle phase (Cancel/Apply + footer hint)", async () => {
        const { container } = render(
            <MutationProposalCard
                onAccept={jest.fn()}
                onReject={jest.fn()}
                onUndo={jest.fn()}
                proposal={baseProposal}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
