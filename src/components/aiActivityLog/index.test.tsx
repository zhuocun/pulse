import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";

import { store } from "../../store";
import {
    aiLedgerActions,
    type AiLedgerEntryState
} from "../../store/reducers/aiLedgerSlice";
import { __resetAiLedgerUndoCallbacksForTests } from "../../utils/hooks/useAiLedger";
import useAiLedger from "../../utils/hooks/useAiLedger";

import AiActivityLog from "./index";

/*
 * A simple test harness that mounts both the activity log + a thin
 * controller exposing the `record()` helper to the tests. We pin the
 * controller onto a closure-captured holder so the suite can call
 * `recordEntry()` without standing up a DOM button to drive each
 * record.
 */
type RecordFn = ReturnType<typeof useAiLedger>["record"];
const harnessRef: { record: RecordFn | null } = { record: null };

const Harness: React.FC = () => {
    const { record } = useAiLedger();
    harnessRef.record = record;
    return <AiActivityLog />;
};

const renderHarness = () =>
    render(
        <Provider store={store}>
            <Harness />
        </Provider>
    );

const recordEntry = (entry: {
    description: string;
    surface: string;
    undo?: () => void | Promise<void>;
}) => {
    act(() => {
        if (!harnessRef.record) throw new Error("Harness not mounted");
        harnessRef.record(entry);
    });
};

const seedStateEntry = (entry: AiLedgerEntryState) =>
    act(() => {
        store.dispatch(aiLedgerActions.recordAiLedgerEntry(entry));
    });

describe("AiActivityLog", () => {
    beforeEach(() => {
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
    });

    afterEach(() => {
        store.dispatch(aiLedgerActions.clearAiLedger());
        __resetAiLedgerUndoCallbacksForTests();
        harnessRef.record = null;
    });

    it("renders nothing when the ledger is empty", () => {
        const { container } = renderHarness();
        expect(container).toBeEmptyDOMElement();
    });

    it("shows the pill with the entry count once a record lands", () => {
        renderHarness();
        recordEntry({
            description: "Applied 3 story points to “Login refactor”",
            surface: "task-assist",
            undo: jest.fn()
        });
        const pill = screen.getByTestId("ai-activity-log-pill");
        expect(pill).toBeInTheDocument();
        expect(pill).toHaveTextContent(/1 AI change/);
    });

    it("pluralises the pill label past one entry", () => {
        renderHarness();
        recordEntry({
            description: "A",
            surface: "task-assist",
            undo: jest.fn()
        });
        recordEntry({
            description: "B",
            surface: "task-draft",
            undo: jest.fn()
        });
        const pill = screen.getByTestId("ai-activity-log-pill");
        expect(pill).toHaveTextContent(/2 AI changes/);
    });

    it("opens a popover with each entry's description on click", async () => {
        const user = userEvent.setup();
        renderHarness();
        recordEntry({
            description: "Applied AI suggestion to “Login” taskName",
            surface: "task-assist",
            undo: jest.fn()
        });
        await user.click(screen.getByTestId("ai-activity-log-pill"));
        const list = await screen.findByTestId("ai-activity-log-list");
        expect(list).toBeInTheDocument();
        expect(
            within(list).getByText(/Applied AI suggestion to/)
        ).toBeInTheDocument();
    });

    it("Revert button fires the entry's undo and removes the row on success", async () => {
        const user = userEvent.setup();
        const undo = jest.fn();
        renderHarness();
        recordEntry({
            description: "Apply",
            surface: "task-assist",
            undo
        });
        await user.click(screen.getByTestId("ai-activity-log-pill"));
        const revert = await screen.findByTestId("ai-activity-log-revert");
        /*
         * `userEvent.click` aborts when AntD's Popover briefly stamps
         * `pointer-events: none` on the overlay during the entrance
         * transition. `fireEvent.click` fires the native click directly,
         * which is what we want to assert the handler wiring.
         */
        fireEvent.click(revert);
        await waitFor(() => {
            expect(undo).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
            // After the only entry is reverted the pill should unmount.
            expect(
                screen.queryByTestId("ai-activity-log-pill")
            ).not.toBeInTheDocument();
        });
    });

    it("hides the Revert button when the entry's callback isn't alive (post-reload state)", async () => {
        const user = userEvent.setup();
        renderHarness();
        // Seed Redux directly so no callback is registered in the Map.
        seedStateEntry({
            id: "ledger-test-1",
            timestamp: Date.now(),
            description: "Pre-reload entry",
            surface: "task-draft",
            undoable: true
        });
        await user.click(await screen.findByTestId("ai-activity-log-pill"));
        const list = await screen.findByTestId("ai-activity-log-list");
        expect(
            within(list).queryByTestId("ai-activity-log-revert")
        ).not.toBeInTheDocument();
        expect(within(list).getByText("Pre-reload entry")).toBeInTheDocument();
    });

    it("logs entries without an undo callback (description still rendered, no Revert)", async () => {
        const user = userEvent.setup();
        renderHarness();
        recordEntry({
            description: "Logged-only mutation",
            surface: "mutation-proposal"
            // no undo
        });
        await user.click(await screen.findByTestId("ai-activity-log-pill"));
        const list = await screen.findByTestId("ai-activity-log-list");
        expect(
            within(list).getByText("Logged-only mutation")
        ).toBeInTheDocument();
        expect(
            within(list).queryByTestId("ai-activity-log-revert")
        ).not.toBeInTheDocument();
    });

    it("renders the most recent entry first", async () => {
        const user = userEvent.setup();
        renderHarness();
        recordEntry({
            description: "First",
            surface: "task-assist",
            undo: jest.fn()
        });
        recordEntry({
            description: "Second",
            surface: "task-assist",
            undo: jest.fn()
        });
        await user.click(screen.getByTestId("ai-activity-log-pill"));
        const list = await screen.findByTestId("ai-activity-log-list");
        const rows = within(list).getAllByTestId("ai-activity-log-row");
        expect(rows).toHaveLength(2);
        // Most recent ("Second") on top.
        expect(rows[0]).toHaveTextContent("Second");
        expect(rows[1]).toHaveTextContent("First");
    });

    it("Clear all empties the ledger after confirming", async () => {
        const user = userEvent.setup();
        renderHarness();
        recordEntry({
            description: "A",
            surface: "task-assist",
            undo: jest.fn()
        });
        recordEntry({
            description: "B",
            surface: "task-draft",
            undo: jest.fn()
        });
        await user.click(screen.getByTestId("ai-activity-log-pill"));
        const list = await screen.findByTestId("ai-activity-log-list");
        // `getByText` is sufficient — the button label is the visible
        // "Clear all" copy. Role queries fail in jsdom because AntD's
        // overlay container marks aria-hidden during the popover
        // entrance frame.
        const clearAllButton = within(list)
            .getByText(/Clear all/i)
            .closest("button");
        expect(clearAllButton).not.toBeNull();
        fireEvent.click(clearAllButton as HTMLElement);
        // Modal.confirm renders a separate dialog.
        const confirmButton = await screen.findByRole("button", {
            name: /^Clear$/i
        });
        fireEvent.click(confirmButton);
        await waitFor(() => {
            expect(
                screen.queryByTestId("ai-activity-log-pill")
            ).not.toBeInTheDocument();
        });
    });
});
