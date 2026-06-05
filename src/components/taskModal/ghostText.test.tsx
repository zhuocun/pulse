/*
 * Phase 4 W3 — TaskModal ghost-text integration check.
 *
 * Targets the conditional in `index.tsx` that swaps the bare
 * `Input.TextArea` for the `<AiGhostText>`-wrapped variant when the
 * `REACT_APP_AI_GHOST_TEXT_ENABLED` flag is on AND the user has
 * acknowledged the route-scoped privacy disclosure. Avoids re-running
 * the entire mutation/lifecycle suite — those live in `index.test.tsx`.
 */
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

import TaskModal from ".";

// Pin the ResponsiveFormSheet branch: desktop Modal by default (so the
// existing ghost-text assertions hold), phone Sheet in the dedicated
// case below to prove the wrapper still wires through after the Sheet
// remounts the subtree fresh on each open.
jest.mock("../../utils/hooks/useIsPhoneChrome");
jest.mock("../../utils/hooks/useReducedMotion");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;
const mockedUseReducedMotion = useReducedMotion as jest.MockedFunction<
    typeof useReducedMotion
>;

jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "/api/v1",
        aiBaseUrl: "",
        aiEnabled: true,
        aiUseLocalEngine: true,
        aiMutationProposalsEnabled: true,
        aiKnowledgeCutoff: "January 2026",
        bottomNavEnabled: true,
        taskPanelRouted: false,
        copilotDockEnabled: false,
        aiColumnReadinessEnabled: false,
        aiGhostTextEnabled: false
    }
}));

const setFlag = (value: boolean) => {
    jest.requireMock("../../constants/env").default.aiGhostTextEnabled = value;
};

const installAntdBrowserMocks = () => {
    // setupTests.ts already wires matchMedia + ResizeObserver as
    // writable but not configurable, so we re-assign the value rather
    // than re-defining the property.
    (
        window as unknown as { matchMedia: (query: string) => MediaQueryList }
    ).matchMedia = ((query: string) => ({
        addEventListener: jest.fn(),
        addListener: jest.fn(),
        dispatchEvent: jest.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: jest.fn(),
        removeListener: jest.fn()
    })) as unknown as (query: string) => MediaQueryList;
};

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "column-1",
    coordinatorId: "member-1",
    epic: "Feature",
    index: 0,
    note: "",
    projectId: "project-1",
    storyPoints: 3,
    taskName: "Build task",
    type: "Task",
    ...overrides
});

const renderModal = () => {
    store.dispatch(overlaysActions.startEditingTask("task-1"));
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users/members"], [member()]);
    queryClient.setQueryData(["projects", { projectId: "project-1" }], {
        _id: "project-1",
        projectName: "Roadmap",
        organization: "Acme",
        managerId: "member-1",
        createdAt: "2026-01-01"
    });
    queryClient.setQueryData(
        ["boards", { projectId: "project-1" }],
        [
            {
                _id: "column-1",
                columnName: "Backlog",
                index: 0,
                projectId: "project-1"
            }
        ]
    );
    // M2 — the modal's label / assignee pickers read these per-project
    // caches. Seed them empty (fresh, via the hooks' staleTime) so they
    // serve from cache and add no extra `fetch` calls to the strict count
    // assertions in this suite.
    queryClient.setQueryData(["labels", { projectId: "project-1" }], []);
    queryClient.setQueryData(
        ["projects/members", { projectId: "project-1" }],
        []
    );
    // M4 comments thread mounts for a real task — seed its per-task cache
    // (fresh, via the 30s staleTime) so it adds no extra `fetch` to the
    // strict count assertions in this suite.
    queryClient.setQueryData(["comments", { taskId: "task-1" }], []);
    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<TaskModal tasks={[task()]} />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

beforeAll(() => {
    installAntdBrowserMocks();
});

beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    setFlag(false);
    mockedUseIsPhoneChrome.mockReturnValue(false);
    mockedUseReducedMotion.mockReturnValue(false);
});

afterEach(() => {
    act(() => {
        jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    store.dispatch(overlaysActions.closeTaskModal());
});

describe("TaskModal ghost-text integration", () => {
    it("renders the plain notes textarea when the ghost-text flag is off", async () => {
        setFlag(false);
        window.localStorage.setItem("boardCopilot:privacyShown:task-note", "1");
        renderModal();
        // Note field should mount as the bare AntD textarea — no
        // ghost-text shell.
        await screen.findByText(/edit task · build task/i);
        expect(screen.queryByTestId("ai-ghost-text")).not.toBeInTheDocument();
    });

    it("renders the plain notes textarea when the flag is on but consent is missing", async () => {
        setFlag(true);
        // localStorage cleared in beforeEach → no consent
        renderModal();
        await screen.findByText(/edit task · build task/i);
        // The privacy disclosure should be visible (consent gate
        // surfaced for the user to acknowledge).
        expect(screen.getAllByText(/got it/i).length).toBeGreaterThan(0);
        // But the wrapper shell is *not* mounted because consent is
        // still false (AiGhostText falls through to the bare child).
        expect(screen.queryByTestId("ai-ghost-text")).not.toBeInTheDocument();
    });

    it("activates the ghost-text wrapper when the flag is on and consent is given", async () => {
        setFlag(true);
        window.localStorage.setItem("boardCopilot:privacyShown:task-note", "1");
        renderModal();
        await screen.findByText(/edit task · build task/i);
        await waitFor(() => {
            expect(screen.getByTestId("ai-ghost-text")).toBeInTheDocument();
        });
    });

    it("renders the overlay after typing and waiting for the debounce", async () => {
        setFlag(true);
        window.localStorage.setItem("boardCopilot:privacyShown:task-note", "1");
        renderModal();
        await screen.findByText(/edit task · build task/i);
        const noteFields = screen
            .getAllByRole("textbox")
            .filter((el) => el.tagName.toLowerCase() === "textarea");
        expect(noteFields.length).toBeGreaterThan(0);
        const note = noteFields[0] as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(note, {
                target: { value: "Customers cannot complete checkout" }
            });
        });
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        await waitFor(() => {
            expect(
                screen.getByTestId("ai-ghost-text-overlay")
            ).toBeInTheDocument();
        });
    });

    it("Tab-accepts the suggestion through AntD Form.Item and submits the merged value", async () => {
        // Highest-risk wiring per the reviewer: the React value-setter +
        // `input` event dispatch must round-trip through AntD's
        // `Form.Item` binding so `form.getFieldValue("note")` updates
        // and the saved payload carries the accepted suggestion. This
        // test proves the end-to-end glue inside the real modal —
        // unit tests in `aiGhostText/index.test.tsx` exercise the
        // wrapper with a hand-rolled host, which cannot detect a
        // Form.Item-binding regression.
        setFlag(true);
        window.localStorage.setItem("boardCopilot:privacyShown:task-note", "1");
        const fetchMock = jest.spyOn(global, "fetch");
        fetchMock.mockResolvedValue({
            json: jest.fn().mockResolvedValue({ _id: "task-1" }),
            ok: true,
            status: 200
        } as unknown as Response);

        try {
            renderModal();
            await screen.findByText(/edit task · build task/i);

            const noteFields = screen
                .getAllByRole("textbox")
                .filter((el) => el.tagName.toLowerCase() === "textarea");
            const note = noteFields[0] as HTMLTextAreaElement;

            // Type a partial value that the engine completes
            // deterministically (the heading-seeded acceptance branch
            // in `noteCompletion`).
            await act(async () => {
                fireEvent.change(note, {
                    target: { value: "## Acceptance criteria" }
                });
            });
            await act(async () => {
                jest.advanceTimersByTime(600);
            });
            await waitFor(() => {
                expect(
                    screen.getByTestId("ai-ghost-text-overlay")
                ).toBeInTheDocument();
            });

            const valueBeforeAccept = note.value;
            // Tab to accept — this is the path the reviewer flagged.
            await act(async () => {
                fireEvent.keyDown(note, { key: "Tab", code: "Tab" });
            });

            // The textarea's own value must reflect the appended completion
            // (the React value-setter / `input` event handoff worked).
            expect(note.value.length).toBeGreaterThan(valueBeforeAccept.length);
            expect(note.value.startsWith(valueBeforeAccept)).toBe(true);
            const expectedNote = note.value;

            // Submit and verify the AntD Form.Item picked up the value
            // — the saved payload must include the accepted note.
            await act(async () => {
                fireEvent.click(
                    screen.getByRole("button", { name: /^save$/i })
                );
            });
            await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
            const body = JSON.parse(
                (fetchMock.mock.calls[0][1] as RequestInit)?.body as string
            );
            expect(body).toEqual(
                expect.objectContaining({
                    _id: "task-1",
                    note: expectedNote
                })
            );
        } finally {
            fetchMock.mockRestore();
        }
    });

    it("activates the ghost-text surface after the user acknowledges the disclosure in the same tab", async () => {
        // Reviewer-flagged regression: `usePrivacyConsent` subscribed to
        // `storage` only, but the HTML spec withholds that event from the
        // tab that wrote the key. Without the same-tab consent signal a
        // first-time user opts in, types into the note, and ghost-text
        // never activates until the modal is closed and reopened. The
        // fix dispatches a custom `ai-privacy-consent-changed` event from
        // the disclosure's `onAcknowledge`, which the hook listens for
        // alongside the cross-tab `storage` event.
        setFlag(true);
        // No consent in localStorage at start.
        renderModal();
        await screen.findByText(/edit task · build task/i);

        const noteFields = screen
            .getAllByRole("textbox")
            .filter((el) => el.tagName.toLowerCase() === "textarea");
        expect(noteFields.length).toBeGreaterThan(0);
        const note = noteFields[0] as HTMLTextAreaElement;

        // 1) Pre-consent: typing must not surface a suggestion because
        //    the surface is gated off (engine never called).
        await act(async () => {
            fireEvent.change(note, {
                target: { value: "Repro: open the app on iOS Safari" }
            });
        });
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        expect(screen.queryByTestId("ai-ghost-text")).not.toBeInTheDocument();
        expect(
            screen.queryByTestId("ai-ghost-text-overlay")
        ).not.toBeInTheDocument();

        // 2) Acknowledge — both buttons read "Got it"/"Don't show again";
        //    grab the primary one (first by document order).
        const ackButton = screen
            .getAllByRole("button")
            .find((btn) => /got it/i.test(btn.textContent ?? ""));
        expect(ackButton).toBeDefined();
        await act(async () => {
            fireEvent.click(ackButton as HTMLElement);
        });

        // 3) The ghost-text shell must now be live without closing the modal.
        await waitFor(() => {
            expect(screen.getByTestId("ai-ghost-text")).toBeInTheDocument();
        });

        // 4) Typing more must now trigger the engine and surface a
        //    suggestion within the debounce window.
        const liveNoteFields = screen
            .getAllByRole("textbox")
            .filter((el) => el.tagName.toLowerCase() === "textarea");
        const liveNote = liveNoteFields[0] as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(liveNote, {
                target: {
                    value: "Repro: open the app on iOS Safari and tap login"
                }
            });
        });
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        await waitFor(() => {
            expect(
                screen.getByTestId("ai-ghost-text-overlay")
            ).toBeInTheDocument();
        });
    });

    it("activates the ghost-text surface inside the phone Sheet and round-trips a suggestion", async () => {
        // Phone-branch coverage for the ResponsiveFormSheet migration. The
        // Sheet remounts the form subtree fresh on every open (it does not
        // honor `forceRender`), so this proves the ghost-text wiring still
        // mounts and surfaces a suggestion when the editor is the bottom
        // Sheet rather than the desktop Modal.
        mockedUseIsPhoneChrome.mockReturnValue(true);
        setFlag(true);
        window.localStorage.setItem("boardCopilot:privacyShown:task-note", "1");
        renderModal();

        const surface = await screen.findByTestId("task-modal-surface");
        await waitFor(() => {
            expect(
                within(surface).getByTestId("ai-ghost-text")
            ).toBeInTheDocument();
        });

        const note = within(surface)
            .getAllByRole("textbox")
            .filter(
                (el) => el.tagName.toLowerCase() === "textarea"
            )[0] as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(note, {
                target: { value: "Customers cannot complete checkout" }
            });
        });
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        await waitFor(() => {
            expect(
                within(surface).getByTestId("ai-ghost-text-overlay")
            ).toBeInTheDocument();
        });
    });
});
