import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { store } from "../../store";
import { activityFeedActions } from "../../store/reducers/activityFeedSlice";
import useUndoToast from "../../utils/hooks/useUndoToast";

import ColumnCreator from ".";

// The transient Undo toast routes through the out-of-scope, AntD-backed
// `useUndoToast`. Mock it so this suite stays free of AntD's global message
// container while still asserting the create flow raises the toast with the
// right copy and a working DELETE-the-column undo closure.
jest.mock("../../utils/hooks/useUndoToast");

interface UndoOptions {
    description: string;
    undo: () => Promise<void>;
}
const showUndoToast = jest.fn();
let lastUndoOptions: UndoOptions | null = null;

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

const renderCreator = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });

    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<ColumnCreator />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("ColumnCreator", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    // Radix Select drives its listbox with pointer-capture + scroll APIs
    // jsdom doesn't ship; polyfill them so the category picker can open.
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
        Element.prototype.hasPointerCapture = jest.fn(() => false);
        Element.prototype.releasePointerCapture = jest.fn();
    });

    beforeEach(() => {
        lastUndoOptions = null;
        showUndoToast.mockReset();
        showUndoToast.mockImplementation((options: UndoOptions) => {
            lastUndoOptions = options;
            return { dismiss: jest.fn() };
        });
        (useUndoToast as jest.Mock).mockReturnValue({ show: showUndoToast });
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(
            response({
                _id: "column-1",
                columnName: "Todo",
                index: 0,
                projectId: "project-1"
            })
        );
        // Clear the activity feed so the Phase 4.3 integration
        // assertion below reads a deterministic event list.
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
        });
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    afterEach(() => {
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
        });
    });

    const expandIntoInput = async () => {
        fireEvent.click(screen.getByRole("button", { name: "Add column" }));
        return screen.findByPlaceholderText(/Create column/);
    };

    it("starts collapsed and reveals the input on click", async () => {
        renderCreator();
        expect(
            screen.getByRole("button", { name: "Add column" })
        ).toBeInTheDocument();
        expect(
            screen.queryByPlaceholderText(/Create column/)
        ).not.toBeInTheDocument();

        const input = await expandIntoInput();
        expect(input).toBeInTheDocument();
    });

    it("creates a column for the current project and clears the input", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "QA" } });
        fireEvent.keyDown(input, {
            charCode: 13,
            code: "Enter",
            key: "Enter"
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/boards");
        // The create payload now carries the column ``category`` (the
        // persisted "done" source of truth); it defaults to "todo".
        expect(fetchMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                body: JSON.stringify({
                    category: "todo",
                    columnName: "QA",
                    projectId: "project-1",
                    wipLimit: 0
                }),
                method: "POST"
            })
        );
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Add column" })
            ).toBeInTheDocument()
        );
    });

    it("defaults the category picker to To do and sends it on create", async () => {
        renderCreator();
        await expandIntoInput();

        // The category Select is rendered alongside the name input and
        // starts on the default "To do" (todo) bucket.
        expect(
            screen.getByRole("combobox", { name: "New column category" })
        ).toHaveTextContent("To do");
    });

    it("sends the chosen category in the create payload", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "Shipped" } });

        // Open the category picker and pick the "Done" bucket.
        const user = userEvent.setup();
        await user.click(
            screen.getByRole("combobox", { name: "New column category" })
        );
        await user.click(await screen.findByRole("option", { name: "Done" }));

        fireEvent.keyDown(input, {
            charCode: 13,
            code: "Enter",
            key: "Enter"
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                body: JSON.stringify({
                    category: "done",
                    columnName: "Shipped",
                    projectId: "project-1",
                    wipLimit: 0
                }),
                method: "POST"
            })
        );
    });

    it("sends the chosen WIP limit in the create payload (PRD-GAP-007)", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "Doing" } });

        // The WIP-limit InputNumber is labelled by the shared `wipLimit`
        // field microcopy; set a positive cap and commit.
        const wipInput = screen.getByRole("spinbutton", {
            name: "WIP limit"
        });
        fireEvent.change(wipInput, { target: { value: "3" } });

        fireEvent.keyDown(input, {
            charCode: 13,
            code: "Enter",
            key: "Enter"
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                body: JSON.stringify({
                    category: "todo",
                    columnName: "Doing",
                    projectId: "project-1",
                    wipLimit: 3
                }),
                method: "POST"
            })
        );
    });

    it("disables the input while the create mutation is pending", async () => {
        let resolveFetch: (value: Response) => void = () => undefined;
        fetchMock.mockReturnValue(
            new Promise<Response>((resolve) => {
                resolveFetch = resolve;
            })
        );
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "Doing" } });
        fireEvent.keyDown(input, {
            charCode: 13,
            code: "Enter",
            key: "Enter"
        });

        await waitFor(() => expect(input).toBeDisabled());
        resolveFetch(response({ _id: "column-2", columnName: "Doing" }));
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Add column" })
            ).toBeInTheDocument()
        );
    });

    it("ignores blank submissions and collapses on Escape", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.keyDown(input, { key: "Escape" });
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Add column" })
            ).toBeInTheDocument()
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // WCAG 2.5.8 (Target Size, Minimum) requires interactive targets be at
    // least 24×24 CSS px, with AAA at 44×44. The "Add column" affordance is
    // the canvas-level commit point for adding a new column and must stay
    // generous on touch. It declares `min-h-[3rem]` (48 px), safely above
    // the AAA target; assert the utility is present so a refactor that
    // drops it fails CI.
    it("declares a touch-target height of at least 44 px (WCAG 2.5.8)", () => {
        renderCreator();
        const button = screen.getByRole("button", { name: "Add column" });
        expect(button).toHaveClass("min-h-[3rem]");
    });

    it("keeps the collapsed desktop add-column slot compact enough to avoid clipping the board", () => {
        renderCreator();
        const button = screen.getByRole("button", { name: "Add column" });
        const slot = button.parentElement;
        expect(slot).not.toBeNull();
        // The collapsed slot pins to a compact 9rem min-width on md+ so it
        // doesn't clip the board; the editing slot widens to 16rem.
        expect(slot).toHaveClass("md:min-w-[9rem]");
    });

    /*
     * Phase 4.3 — integration assertion. The column-create flow
     * must surface a corresponding row in the activity feed (the
     * bell-icon source of truth). The assertion reads Redux
     * directly so it's independent of any particular drawer-UI
     * affordance.
     */
    it("records an activity-feed event when a column is created (Phase 4.3 integration)", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "QA" } });
        fireEvent.keyDown(input, {
            charCode: 13,
            code: "Enter",
            key: "Enter"
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() => {
            const events = store.getState().activityFeed.events;
            expect(events).toHaveLength(1);
            expect(events[0].kind).toBe("column");
            expect(events[0].action).toBe("create");
            expect(events[0].summary).toContain("QA");
        });
    });

    /*
     * §2.A.4 — a create is reversible, so it surfaces a transient Undo
     * toast alongside the activity feed. Clicking Undo replays the inverse
     * mutation: a DELETE that removes the just-created column by id.
     */
    it("surfaces an Undo toast after create and re-DELETEs the column on click", async () => {
        fetchMock.mockReset();
        fetchMock.mockImplementation((_input, init) => {
            const method = (init as RequestInit | undefined)?.method ?? "GET";
            if (method === "POST") {
                return Promise.resolve(
                    response({ _id: "server-column-id", columnName: "QA" })
                );
            }
            return Promise.resolve(response({ ok: true }));
        });

        renderCreator();
        const input = await expandIntoInput();
        fireEvent.change(input, { target: { value: "QA" } });
        fireEvent.keyDown(input, {
            charCode: 13,
            code: "Enter",
            key: "Enter"
        });

        await waitFor(() =>
            expect(
                fetchMock.mock.calls.some(
                    ([, init]) =>
                        (init as RequestInit | undefined)?.method === "POST"
                )
            ).toBe(true)
        );
        // The create flow raises the transient Undo toast with the created
        // copy; its `undo` closure DELETEs the just-created column by id.
        await waitFor(() => expect(showUndoToast).toHaveBeenCalledTimes(1));
        expect(showUndoToast).toHaveBeenCalledWith(
            expect.objectContaining({
                description: microcopy.feedback.columnCreated
            })
        );
        await act(async () => {
            await lastUndoOptions?.undo();
        });

        const deleteCall = fetchMock.mock.calls.find(
            ([, init]) => (init as RequestInit | undefined)?.method === "DELETE"
        );
        expect(deleteCall).toBeDefined();
        expect(String(deleteCall?.[0])).toContain("/api/v1/boards");
        expect(String(deleteCall?.[0])).toContain("columnId=server-column-id");
    });

    it("does not submit a named column just because the input blurs", async () => {
        renderCreator();
        const input = await expandIntoInput();

        fireEvent.change(input, { target: { value: "Later" } });
        fireEvent.blur(input);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByDisplayValue("Later")).toBeInTheDocument();
    });
});
