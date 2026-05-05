import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import {
    ANALYTICS_EVENTS,
    setAnalyticsSink,
    type AnalyticsSink
} from "../../constants/analytics";
import type { MutationProposal } from "../../interfaces/agent";

import MutationProposalCard from ".";

expect.extend(toHaveNoViolations);

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

    it("renders an Undo button when proposal.undoable is true AND onUndo is supplied, and fires AGENT_PROPOSAL_UNDONE on click", () => {
        const onUndo = jest.fn();
        render(
            <MutationProposalCard
                onAccept={jest.fn()}
                onReject={jest.fn()}
                onUndo={onUndo}
                proposal={baseProposal}
            />
        );

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
    });

    it("hides the Undo CTA when proposal.undoable is false even if onUndo is supplied", () => {
        // The shipped MutationProposal type pins `undoable: true` at the
        // schema level, but at runtime the BE could narrow the field —
        // guard the FE-side render so a future "non-undoable" proposal
        // doesn't surface a button that would be a guaranteed no-op.
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
        expect(
            screen.queryByRole("button", { name: /Undo this proposal/i })
        ).not.toBeInTheDocument();
    });

    it("has no axe-detectable a11y violations when the Undo CTA is rendered", async () => {
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
