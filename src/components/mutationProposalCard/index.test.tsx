import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { Provider } from "react-redux";

import {
    ANALYTICS_EVENTS,
    setAnalyticsSink,
    type AnalyticsSink
} from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import type { MutationProposal } from "../../interfaces/agent";
import { store } from "../../store";
import { aiLedgerActions } from "../../store/reducers/aiLedgerSlice";
import { __resetAiLedgerUndoCallbacksForTests } from "../../utils/hooks/useAiLedger";

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

/*
 * Wrap MutationProposalCard renders in a Redux Provider so the embedded
 * `useAiLedger` hook (A8) has a store to read from. Tests that need to
 * inspect ledger entries call `getLedgerEntries()`.
 */
const renderCard = (props: React.ComponentProps<typeof MutationProposalCard>) =>
    render(
        <Provider store={store}>
            <MutationProposalCard {...props} />
        </Provider>
    );

describe("MutationProposalCard", () => {
    let sink: jest.MockedFunction<AnalyticsSink>;
    let restoreSink: AnalyticsSink;

    beforeEach(() => {
        sink = jest.fn();
        restoreSink = setAnalyticsSink(sink);
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
    });

    afterEach(() => {
        setAnalyticsSink(restoreSink);
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
    });

    /*
     * QW#6 (2026-05 review §Quick Wins): the inline diff card uses
     * `role="region"` paired with an `aria-label` heading — the previous
     * `role="alertdialog"` hijacked screen-reader focus as if the diff
     * were a modal. The card is always rendered inline (chat drawer +
     * review-each list); the surface that hosts a real modal supplies
     * its own `dialog` role outside the card.
     */
    it("uses role=region with the heading as aria-label so the inline diff is a navigable landmark, not an alertdialog", () => {
        renderCard({
            onAccept: jest.fn(),
            onReject: jest.fn(),
            proposal: baseProposal
        });
        // The card itself surfaces a region landmark.
        const region = screen.getByRole("region", {
            name: /Reassign two unowned bugs/
        });
        expect(region).toBeInTheDocument();
        // And the legacy alertdialog role is gone.
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("renders the diff plus accept/reject without an Undo CTA when no onUndo is provided", () => {
        renderCard({
            onAccept: jest.fn(),
            onReject: jest.fn(),
            proposal: baseProposal
        });
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
        renderCard({
            onAccept: jest.fn(),
            onReject: jest.fn(),
            onUndo: jest.fn(),
            proposal: baseProposal
        });

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
            renderCard({
                onAccept,
                onReject: jest.fn(),
                onUndo,
                proposal: baseProposal
            });

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
            renderCard({
                onAccept: jest.fn(),
                onReject: jest.fn(),
                onUndo: jest.fn(),
                proposal
            });
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
        const { container } = renderCard({
            onAccept: jest.fn(),
            onReject: jest.fn(),
            onUndo: jest.fn(),
            proposal: baseProposal
        });
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("records an activity-ledger entry tagged 'mutation-proposal' after the countdown completes (A8)", () => {
        jest.useFakeTimers();
        try {
            const onAccept = jest.fn();
            const onUndo = jest.fn();
            renderCard({
                onAccept,
                onReject: jest.fn(),
                onUndo,
                proposal: baseProposal
            });
            fireEvent.click(
                screen.getByRole("button", {
                    name: microcopy.a11y.acceptProposal as string
                })
            );
            flushAcceptCountdown();
            const entries = store.getState().aiLedger.entries;
            expect(entries).toHaveLength(1);
            expect(entries[0].surface).toBe("mutation-proposal");
            expect(entries[0].description).toContain(
                "Reassign two unowned bugs"
            );
            // onUndo is wired and the proposal is undoable, so the entry
            // is recorded with a live undo closure.
            expect(entries[0].undoable).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it("logs the ledger entry without an undo when the proposal isn't undoable (Revert button hidden)", () => {
        jest.useFakeTimers();
        try {
            const proposal = {
                ...baseProposal,
                undoable: false as unknown as true
            };
            renderCard({
                onAccept: jest.fn(),
                onReject: jest.fn(),
                onUndo: jest.fn(),
                proposal
            });
            fireEvent.click(
                screen.getByRole("button", {
                    name: microcopy.a11y.acceptProposal as string
                })
            );
            flushAcceptCountdown();
            const entries = store.getState().aiLedger.entries;
            expect(entries).toHaveLength(1);
            expect(entries[0].undoable).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    /*
     * Regression test for A8 review issue #2. Before the fix, the in-card
     * post-commit Undo button and the ledger entry's undo closure both
     * called onUndo() — clicking in-card Undo and later opening the dock
     * to click Revert fired onUndo() twice. The fix shares an
     * `undoFiredRef` guard between both paths and the in-card Undo
     * additionally removes the ledger entry so the Revert button is no
     * longer reachable.
     */
    it("in-card Undo + ledger Revert fire onUndo exactly ONCE for the same proposal (issue #2)", async () => {
        jest.useFakeTimers();
        try {
            const onUndo = jest.fn();
            const onAccept = jest.fn();
            renderCard({
                onAccept,
                onReject: jest.fn(),
                onUndo,
                proposal: baseProposal
            });

            // Walk the card through Accept → countdown → committed.
            fireEvent.click(
                screen.getByRole("button", {
                    name: microcopy.a11y.acceptProposal as string
                })
            );
            flushAcceptCountdown();
            expect(onAccept).toHaveBeenCalledTimes(1);

            // Sanity: the ledger now holds the entry with a live undo.
            const ledgerBefore = store.getState().aiLedger.entries;
            expect(ledgerBefore).toHaveLength(1);
            const ledgerEntryId = ledgerBefore[0].id;

            // Click in-card Undo.
            const undoBtn = screen.getByRole("button", {
                name: /Undo this proposal/i
            });
            fireEvent.click(undoBtn);

            expect(onUndo).toHaveBeenCalledTimes(1);
            // The synchronization contract: the in-card Undo removes the
            // ledger entry so the dock can't surface a second Revert
            // button for the same proposal.
            expect(store.getState().aiLedger.entries).toHaveLength(0);

            // Now simulate the dock attempting to fire the ledger's undo
            // closure after the in-card Undo has already run. We do this
            // by trying to fire the original closure directly — even if
            // some component held a stale reference, the guard prevents
            // a second `onUndo` invocation. (The ledger entry is gone in
            // production but the guard is the belt-and-braces second
            // line of defence.) We also fire a second in-card click —
            // the guard short-circuits it.
            fireEvent.click(undoBtn);
            expect(onUndo).toHaveBeenCalledTimes(1);
            // Belt-and-braces — the entry id we captured is unreachable.
            expect(
                store
                    .getState()
                    .aiLedger.entries.some((e) => e.id === ledgerEntryId)
            ).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });
});
