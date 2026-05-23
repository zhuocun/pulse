import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { store } from "../../store";
import { activityFeedActions } from "../../store/reducers/activityFeedSlice";

import TaskCreator from ".";

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    ...member(),
    likedProjects: [],
    ...overrides
});

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

const renderCreator = ({
    disabled = false,
    boardAiOn = true
}: { disabled?: boolean; boardAiOn?: boolean } = {}) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users"], user());

    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <TaskCreator
                                    boardAiOn={boardAiOn}
                                    columnId="column-1"
                                    disabled={disabled}
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("TaskCreator", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: () => ({
                addEventListener: jest.fn(),
                addListener: jest.fn(),
                dispatchEvent: jest.fn(),
                matches: false,
                media: "",
                onchange: null,
                removeEventListener: jest.fn(),
                removeListener: jest.fn()
            })
        });
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(
            response({
                _id: "task-1",
                taskName: "New task"
            })
        );
        // Clear the activity feed between tests so the integration
        // assertion below can read a deterministic event list.
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
        });
    });

    afterEach(() => {
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
        });
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    const createButton = () =>
        screen.getByRole("button", { name: /^create task$/i });

    it("starts in link mode, exits on blur, and clears draft text", () => {
        renderCreator();

        fireEvent.click(createButton());
        fireEvent.change(
            screen.getByPlaceholderText("What needs to be done?"),
            {
                target: { value: "Draft task" }
            }
        );
        fireEvent.blur(screen.getByPlaceholderText("What needs to be done?"));

        expect(createButton()).toBeInTheDocument();

        fireEvent.click(createButton());

        expect(
            screen.getByPlaceholderText("What needs to be done?")
        ).toHaveValue("");
    });

    it("creates a task with only the name and column context — no canned defaults", async () => {
        // Quick-create posts the four fields the user actually supplied
        // (name + project/column/coordinator context). Type, epic, story
        // points and note are left for the server-side default or the
        // task modal to fill in — sending canned strings here means every
        // follow-up edit is undoing a placeholder ("No note yet" et al.).
        renderCreator();

        fireEvent.click(createButton());
        fireEvent.change(
            screen.getByPlaceholderText("What needs to be done?"),
            {
                target: { value: "Ship the thing" }
            }
        );
        fireEvent.keyDown(
            screen.getByPlaceholderText("What needs to be done?"),
            {
                charCode: 13,
                code: "Enter",
                key: "Enter"
            }
        );

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/tasks");
        const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
        expect(body).toEqual({
            columnId: "column-1",
            coordinatorId: "member-1",
            projectId: "project-1",
            taskName: "Ship the thing"
        });
        expect(body).not.toHaveProperty("type");
        expect(body).not.toHaveProperty("epic");
        expect(body).not.toHaveProperty("storyPoints");
        expect(body).not.toHaveProperty("note");
        expect(fetchMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({ method: "POST" })
        );
        expect(createButton()).toBeInTheDocument();
    });

    it("disables the create button when the parent column is disabled", () => {
        renderCreator({ disabled: true });

        expect(createButton()).toBeDisabled();
    });

    it("hides Draft with AI when boardAiOn is false", () => {
        renderCreator({ boardAiOn: false });
        expect(
            screen.queryByLabelText(microcopy.actions.draftWithAi)
        ).not.toBeInTheDocument();
    });

    it("opens the Board Copilot draft modal from the Draft with AI button", async () => {
        renderCreator();
        fireEvent.click(screen.getByLabelText(microcopy.actions.draftWithAi));
        await waitFor(() =>
            expect(screen.getByLabelText("Task prompt")).toBeInTheDocument()
        );
    });

    // WCAG 2.5.8 (Target Size, Minimum) requires interactive targets be at
    // least 24×24 CSS px, with AAA at 44×44. The per-column "Create task"
    // trigger is the primary commit point for adding work to the board and
    // its styled component declares `@media (pointer: coarse) { min-height:
    // 44px }` so a thumb can land it without zoom. Walk the rendered
    // stylesheet (same approach as `src/layouts/authLayout.test.tsx` for
    // `AuthButton`) and assert the 44 px declaration is still emitted — a
    // future style refactor that drops it below 44 must fail CI.
    it("declares a touch-target height of at least 44 px (WCAG 2.5.8)", () => {
        renderCreator();
        const button = createButton();
        const styledCls = button.className
            .split(/\s+/)
            .find(
                (tok) =>
                    /^css-[a-z0-9]{4,}$/i.test(tok) &&
                    !tok.startsWith("css-var-") &&
                    !tok.startsWith("css-dev-only-")
            );
        expect(styledCls).toBeTruthy();

        // Walk every stylesheet's rules — including nested rules inside
        // `@media` blocks where the coarse-pointer 44 px lift lives —
        // and collect any `(min-)?height: <N>px` declaration on a rule
        // that mentions the styled class.
        const heights: number[] = [];
        const visit = (rule: CSSRule) => {
            if (rule instanceof CSSStyleRule) {
                if (!styledCls || !rule.selectorText.includes(styledCls))
                    return;
                const re = /(?:^|[\s;{])(?:min-)?height:\s*(\d+(?:\.\d+)?)px/gi;
                let m: RegExpExecArray | null = re.exec(rule.cssText);
                while (m !== null) {
                    heights.push(parseFloat(m[1] ?? "0"));
                    m = re.exec(rule.cssText);
                }
            } else if ("cssRules" in rule) {
                for (const child of Array.from(
                    (rule as CSSGroupingRule).cssRules
                )) {
                    visit(child);
                }
            }
        };
        Array.from(document.styleSheets).forEach((sheet) => {
            let rules: CSSRuleList;
            try {
                rules = sheet.cssRules;
            } catch {
                return;
            }
            for (const rule of Array.from(rules)) visit(rule);
        });

        // The styled component's `@media (pointer: coarse) { min-height:
        // 44px }` rule must surface. A regression to a smaller value or a
        // removed rule fails loudly.
        expect(heights).toContain(44);
    });

    /*
     * Phase 4.3 — integration assertion. A task-create flow that
     * goes through `useReactMutation` must surface a corresponding
     * row in the activity feed (the bell-icon source of truth). The
     * assertion reads Redux directly so it's independent of any
     * particular drawer-UI affordance.
     */
    it("records an activity-feed event when a task is created (Phase 4.3 integration)", async () => {
        renderCreator();
        fireEvent.click(createButton());
        fireEvent.change(
            screen.getByPlaceholderText("What needs to be done?"),
            {
                target: { value: "Ship the activity feed" }
            }
        );
        fireEvent.keyDown(
            screen.getByPlaceholderText("What needs to be done?"),
            {
                charCode: 13,
                code: "Enter",
                key: "Enter"
            }
        );
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() => {
            const events = store.getState().activityFeed.events;
            expect(events).toHaveLength(1);
            expect(events[0].kind).toBe("task");
            expect(events[0].action).toBe("create");
            expect(events[0].summary).toContain("Ship the activity feed");
        });
    });

    /*
     * Phase 4.3 — undo closure test. The brief required each
     * create site to register a fire-and-forget undo on the
     * activity feed so the 10s-window Undo button in the drawer
     * actually reverses the action. For task create the closure
     * DELETEs the just-created task; this test triggers the
     * closure through the public `undo(id)` surface and asserts
     * the DELETE request goes through. One test per closure SHAPE
     * is enough — the other create sites share the pattern.
     */
    it("registers an undo closure that DELETEs the created task", async () => {
        // Mock the responses: POST returns a task with a known
        // `_id` so the undo closure has something to target; the
        // DELETE response can be any 2xx.
        fetchMock.mockReset();
        fetchMock.mockImplementation((input, init) => {
            const method = (init as RequestInit | undefined)?.method ?? "GET";
            if (method === "POST") {
                return Promise.resolve(
                    response({ _id: "server-task-id", taskName: "Reversible" })
                );
            }
            if (method === "DELETE") {
                return Promise.resolve(response({ ok: true }));
            }
            return Promise.resolve(response({}));
        });

        renderCreator();
        fireEvent.click(createButton());
        fireEvent.change(
            screen.getByPlaceholderText("What needs to be done?"),
            {
                target: { value: "Reversible" }
            }
        );
        fireEvent.keyDown(
            screen.getByPlaceholderText("What needs to be done?"),
            {
                charCode: 13,
                code: "Enter",
                key: "Enter"
            }
        );
        // Wait for the create POST + activity event landing.
        await waitFor(() => {
            const events = store.getState().activityFeed.events;
            expect(events).toHaveLength(1);
            expect(events[0].undoable).toBe(true);
        });

        // Drive the activity-feed undo from a probe that uses the
        // same Provider, so the module-scope closure Map is
        // reachable. We can't import the hook output directly into
        // a non-React scope; rendering a probe is the canonical
        // pattern shared with `useActivityFeed.test.tsx`.
        // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
        const { default: useActivityFeed } =
            require("../../utils/hooks/useActivityFeed") as typeof import("../../utils/hooks/useActivityFeed");
        let capturedUndo: ((id: string) => Promise<void>) | null = null;
        const UndoProbe: React.FC = () => {
            const api = useActivityFeed();
            capturedUndo = api.undo;
            return null;
        };
        render(
            <Provider store={store}>
                <UndoProbe />
            </Provider>
        );
        const eventId = store.getState().activityFeed.events[0].id;
        await act(async () => {
            await capturedUndo!(eventId);
        });

        // The undo() call must have issued a DELETE on the
        // tasks endpoint targeting the server-side id from the
        // create response.
        const deleteCall = fetchMock.mock.calls.find(
            ([, init]) => (init as RequestInit | undefined)?.method === "DELETE"
        );
        expect(deleteCall).toBeDefined();
        expect(String(deleteCall?.[0])).toContain("/api/v1/tasks");
        expect(String(deleteCall?.[0])).toContain("taskId=server-task-id");
    });

    it("closes the draft modal and returns to link mode", async () => {
        renderCreator();
        fireEvent.click(screen.getByLabelText(microcopy.actions.draftWithAi));
        await waitFor(() =>
            expect(screen.getByLabelText("Task prompt")).toBeInTheDocument()
        );
        fireEvent.click(screen.getByRole("button", { name: /close/i }));
        await waitFor(() => {
            expect(
                screen.queryByLabelText("Task prompt")
            ).not.toBeInTheDocument();
        });
        expect(
            screen.getByLabelText(microcopy.actions.draftWithAi)
        ).toBeInTheDocument();
    });
});
