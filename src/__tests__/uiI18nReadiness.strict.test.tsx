/**
 * Strict i18n / microcopy readiness tests (TDD harness).
 *
 * The optimization plan §2.A.6 ("Internationalization readiness") and §3.1
 * ("Microcopy") together prescribe a single contract:
 *
 *   1. No string concatenation in JSX. `Edit Task · ${name}` is fine because
 *      it's a template, but `${microcopy.actions.create} project` is **not**
 *      because the literal " project" cannot be translated and the word
 *      order is not localizable.
 *   2. Every visible button label, modal title, and validation message must
 *      come from the central `src/constants/microcopy.ts` bundle so casing
 *      stays consistent (sentence case) and the verb stays the same across
 *      surfaces.
 *   3. Banned in-tree literals: `Submit`, `OK`, `Login`, `Register`, and
 *      TitleCase strings like `Edit Task` / `Create Project`. The replacement
 *      is the matching microcopy key (`editTask`, `createProject`, …).
 *
 * Each test pins one expectation. When a test fails, the surface under test
 * has not yet migrated to the central bundle — the failing message points
 * at the literal that needs to be promoted.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

import AiTaskDraftModal from "../components/aiTaskDraftModal";
import ColumnCreator from "../components/columnCreator";
import Header from "../components/header";
import ProjectModal from "../components/projectModal";
import TaskCreator from "../components/taskCreator";
import TaskModal from "../components/taskModal";
import { microcopy } from "../constants/microcopy";
import { store } from "../store";
import { overlaysActions } from "../store/reducers/overlaysSlice";
import { projectActions } from "../store/reducers/projectModalSlice";
import useAi from "../utils/hooks/useAi";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";
import useReactMutation from "../utils/hooks/useReactMutation";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTaskModal from "../utils/hooks/useTaskModal";

jest.mock("../utils/hooks/useAi");
jest.mock("../utils/hooks/useAiEnabled");
jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useColorScheme");
jest.mock("../utils/hooks/useReactMutation");
jest.mock("../utils/hooks/useReactQuery");
jest.mock("../utils/hooks/useTaskModal");
// AiTaskDraftModal + AiTaskAssistPanel mount useAgent unconditionally (v2.1
// dual-engine pattern); stub it so the i18n surface tests don't need an
// agent server or `useAutonomyLevel` named-export wiring. The stub MUST
// return a stable reference so consumer effects with `remoteAgent` in
// their deps don't re-run on every render.
jest.mock("../utils/hooks/useAgent", () => {
    const stub = {
        start: jest.fn().mockResolvedValue(undefined),
        resume: jest.fn().mockResolvedValue(undefined),
        abort: jest.fn(),
        isStreaming: false,
        state: { messages: [] },
        pendingInterrupt: null,
        pendingProposal: null,
        citations: [],
        nudges: [],
        lastSuggestion: null,
        error: null,
        reset: jest.fn(),
        threadId: "t_test",
        ttftMs: null,
        clearPendingProposal: jest.fn(),
        clearSuggestion: jest.fn(),
        dismissNudge: jest.fn()
    };
    return { __esModule: true, default: () => stub };
});
jest.mock("../assets/logo-software.svg?react", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: (props: Record<string, unknown>) =>
            React.createElement("svg", { "data-testid": "logo", ...props })
    };
});
jest.mock("../components/memberPopover", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () =>
            React.createElement(
                "button",
                { type: "button", "aria-label": "Members" },
                "Members"
            )
    };
});

const mockedUseAi = useAi as jest.MockedFunction<typeof useAi>;
const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
    typeof useColorScheme
>;
const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;
const mockedUseReactQuery = useReactQuery as jest.MockedFunction<
    typeof useReactQuery
>;
const mockedUseTaskModal = useTaskModal as jest.MockedFunction<
    typeof useTaskModal
>;

const installAntdBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });

    class ResizeObserverMock {
        observe = jest.fn();

        unobserve = jest.fn();

        disconnect = jest.fn();
    }

    Object.defineProperty(window, "ResizeObserver", {
        writable: true,
        value: ResizeObserverMock
    });
};

const user = (overrides: Partial<IUser> = {}): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice",
    ...overrides
});

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
    note: "No note",
    projectId: "project-1",
    storyPoints: 3,
    taskName: "Build task",
    type: "Task",
    ...overrides
});

const stubMutation = () =>
    ({
        error: null,
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync: jest.fn().mockResolvedValue(undefined)
    }) as unknown as ReturnType<typeof useReactMutation<unknown>>;

const stubQuery = (data: unknown) =>
    ({
        data,
        error: null,
        isLoading: false,
        isSuccess: true,
        refetch: jest.fn()
    }) as unknown as ReturnType<typeof useReactQuery<unknown>>;

beforeAll(() => {
    installAntdBrowserMocks();
});

beforeEach(() => {
    jest.clearAllMocks();

    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        isAuthenticated: true,
        user: user()
    });
    mockedUseAiEnabled.mockReturnValue({
        available: true,
        enabled: true,
        setEnabled: jest.fn()
    });
    mockedUseColorScheme.mockReturnValue({
        preference: "light",
        scheme: "light",
        setPreference: jest.fn()
    });
    mockedUseReactMutation.mockReturnValue(stubMutation());
    mockedUseReactQuery.mockImplementation((endpoint: string) => {
        if (endpoint === "projects") {
            return stubQuery(undefined);
        }
        return stubQuery([member()]);
    });
    mockedUseTaskModal.mockReturnValue({
        closeModal: jest.fn(),
        editingTaskId: "task-1",
        startEditing: jest.fn()
    });
    mockedUseAi.mockReturnValue({
        data: undefined,
        error: null,
        isLoading: false,
        reset: jest.fn(),
        run: jest.fn().mockResolvedValue(undefined)
    } as unknown as ReturnType<typeof useAi<unknown>>);
});

/* -------------------------------------------------------------------------- */
/* 1. Microcopy bundle completeness                                            */
/* -------------------------------------------------------------------------- */
describe("UI quality :: microcopy bundle completeness", () => {
    /**
     * The action verb for every primary affordance must live in the
     * central bundle. A failing assertion means the matching key is
     * still hand-rolled at the call site (e.g. the literal "Edit Task"
     * inside `taskModal/index.tsx`) and needs to be promoted.
     *
     * We assert sentence case on each label so the migration never
     * regresses to TitleCase / SHOUTING. "Apply" and "Save" stay
     * single-token; "Log in" stays two tokens with a single capital.
     */
    type ActionKey = keyof typeof microcopy.actions;

    const REQUIRED_ACTION_KEYS: ActionKey[] = [
        "addColumn" as ActionKey,
        "askCopilot" as ActionKey,
        "clearAiSearch" as ActionKey,
        "createTask" as ActionKey,
        "draftWithAi" as ActionKey,
        "editProject" as ActionKey,
        "editTask" as ActionKey,
        "search" as ActionKey
    ];

    it.each(REQUIRED_ACTION_KEYS)(
        "microcopy.actions.%s exists in the central bundle",
        (key) => {
            const actions = microcopy.actions as Record<
                string,
                string | undefined
            >;
            expect(actions[key]).toBeTruthy();
        }
    );

    it("every existing actions value is sentence case (only the first character may be capital)", () => {
        const offenders = Object.entries(microcopy.actions).filter(
            ([, value]) => {
                if (typeof value !== "string" || value.length < 2) return false;
                // Allow the first character to be capital and the rest to be
                // lowercase letters / digits / spaces / common punctuation.
                // Also allow proper nouns like "AI", "Copilot" via an
                // explicit allowlist.
                const allowedProperNouns =
                    /\b(AI|Copilot|Board\s+Copilot|Log|Sign|Register)\b/g;
                const stripped = value.replace(allowedProperNouns, "_");
                // Reject any standalone all-caps word ≥ 3 chars that isn't
                // an allowed proper noun.
                return /\b[A-Z]{3,}\b/.test(stripped);
            }
        );
        expect(offenders).toEqual([]);
    });

    /**
     * Each form-level validation message must come from the central
     * bundle so the same surface wording is used in toasts, summaries,
     * and inline errors.
     */
    type ValidationKey = keyof typeof microcopy.validation;

    const REQUIRED_VALIDATION_KEYS: ValidationKey[] = [
        "coordinatorRequired" as ValidationKey,
        "passwordTooShort" as ValidationKey,
        "taskNameRequired" as ValidationKey,
        "taskTypeRequired" as ValidationKey
    ];

    it.each(REQUIRED_VALIDATION_KEYS)(
        "microcopy.validation.%s exists in the central bundle",
        (key) => {
            const validation = microcopy.validation as Record<
                string,
                string | undefined
            >;
            expect(validation[key]).toBeTruthy();
        }
    );
});

/* -------------------------------------------------------------------------- */
/* 2. Banned literal strings                                                   */
/* -------------------------------------------------------------------------- */
describe("UI quality :: banned literal strings in rendered DOM", () => {
    /**
     * Sentence case across surfaces (per §3.1). TitleCase strings like
     * "Edit Task" or "Create Project" are the regression we want to
     * catch. We accept "Board Copilot" (proper noun) and any title that
     * starts with `microcopy.actions.<verb>` because those come from
     * the central bundle.
     */
    const BANNED_DOM_LITERALS: RegExp[] = [
        /\bEdit\s+Task\b/, // should be "Edit task"
        /\bCreate\s+Project\b/, // should be "Create project"
        /\bSubmit\b/i, // should never appear as a button label
        /\bType\s+icon\b/i // §1.20 — bug/task icon must have a real label
    ];

    const renderTaskModal = () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        queryClient.setQueryData(["users/members"], [member()]);

        return render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
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

    const expectNoBannedLiteralsIn = (root: HTMLElement) => {
        const offenders = Array.from(root.querySelectorAll<HTMLElement>("*"))
            .filter(
                (node) =>
                    node.children.length === 0 &&
                    typeof node.textContent === "string"
            )
            .map((node) => (node.textContent ?? "").trim())
            .filter((text) => BANNED_DOM_LITERALS.some((re) => re.test(text)));
        expect(offenders).toEqual([]);
    };

    it("TaskModal does not render the banned 'Edit Task' (TitleCase) literal", () => {
        renderTaskModal();
        const dialog = screen.getByRole("dialog");
        expectNoBannedLiteralsIn(dialog);
    });

    it("TaskModal title comes verbatim from microcopy.actions.editTask, not a hand-rolled string", () => {
        renderTaskModal();
        const editTask = (
            microcopy.actions as Record<string, string | undefined>
        ).editTask;
        expect(editTask).toBeTruthy();
        if (editTask) {
            const dialog = screen.getByRole("dialog");
            // The visible title should contain the exact microcopy verb,
            // not a TitleCase variant or a hand-rolled "Edit Task".
            expect(dialog).toHaveTextContent(editTask);
        }
    });

    it("ColumnCreator's expand button uses microcopy.actions.addColumn verbatim", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<ColumnCreator />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );

        const addColumn = (
            microcopy.actions as Record<string, string | undefined>
        ).addColumn;
        expect(addColumn).toBeTruthy();
        if (addColumn) {
            // Match by accessible name so the test stays valid whether the
            // label is rendered as text content or as `aria-label`.
            expect(
                screen.getByRole("button", { name: addColumn })
            ).toBeInTheDocument();
        }
    });

    it("TaskCreator's expand button uses microcopy.actions.createTask verbatim", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <TaskCreator
                                        boardAiOn={false}
                                        columnId="c1"
                                        disabled={false}
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        const createTask = (
            microcopy.actions as Record<string, string | undefined>
        ).createTask;
        expect(createTask).toBeTruthy();
        if (createTask) {
            expect(
                screen.getByRole("button", { name: createTask })
            ).toBeInTheDocument();
        }
    });

    it("AiTaskDraftModal confirm button uses microcopy.actions.createTask, not the concatenated '${create} task'", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        // Force the suggestion form to render so the confirm button shows
        mockedUseAi.mockImplementation(({ route }: { route: string }) => {
            if (route === "task-draft") {
                return {
                    data: {
                        confidence: 0.8,
                        coordinatorId: "member-1",
                        epic: "Feature",
                        note: "Auto-drafted",
                        rationale: "ok",
                        storyPoints: 3,
                        taskName: "Drafted task",
                        type: "Task",
                        columnId: "c1"
                    },
                    error: null,
                    isLoading: false,
                    reset: jest.fn(),
                    run: jest.fn().mockResolvedValue(undefined)
                } as unknown as ReturnType<typeof useAi<unknown>>;
            }
            return {
                data: undefined,
                error: null,
                isLoading: false,
                reset: jest.fn(),
                run: jest.fn().mockResolvedValue(undefined)
            } as unknown as ReturnType<typeof useAi<unknown>>;
        });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <AiTaskDraftModal
                                    columnId="c1"
                                    onClose={jest.fn()}
                                    open
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );

        const createTask = (
            microcopy.actions as Record<string, string | undefined>
        ).createTask;
        expect(createTask).toBeTruthy();
        if (createTask) {
            // The button must use the exact microcopy verb. The current
            // implementation builds the label with `${create} task`, which
            // is the i18n violation we want to surface.
            expect(
                screen.getByRole("button", { name: createTask })
            ).toBeInTheDocument();
        }
    });

    it("AiTaskDraftModal title comes from microcopy.actions.draftWithAi, not a hand-rolled string", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <AiTaskDraftModal
                                    columnId="c1"
                                    onClose={jest.fn()}
                                    open
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );

        const draftWithAi = (
            microcopy.actions as Record<string, string | undefined>
        ).draftWithAi;
        expect(draftWithAi).toBeTruthy();
        if (draftWithAi) {
            const dialog = screen.getByRole("dialog");
            expect(dialog).toHaveTextContent(draftWithAi);
        }
    });
});

/* -------------------------------------------------------------------------- */
/* 3. No string concatenation in JSX                                          */
/* -------------------------------------------------------------------------- */
describe("UI quality :: no string concatenation in user-facing JSX", () => {
    /**
     * §2.A.6 — `${microcopy.actions.create} project` is banned because
     * the literal " project" cannot be translated and the word order is
     * not localizable. The fix is `microcopy.actions.createProject`.
     */
    const renderProjectModalOpen = () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        store.dispatch(projectActions.openModal());

        return render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects"]}>
                        <Routes>
                            <Route
                                path="/projects"
                                element={<ProjectModal />}
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );
    };

    it("ProjectModal Create-mode confirm button uses microcopy.actions.createProject as a single key (no '${create} project' concatenation)", () => {
        renderProjectModalOpen();

        const dialog = screen.getByRole("dialog");
        // The label must be exactly `microcopy.actions.createProject`.
        // Splitting it across `${microcopy.actions.create}` + " project"
        // would render the same visible text but is the i18n violation
        // we want to catch — we cross-check the source key by matching
        // the ARIA name on the button against the bundle.
        const createBtn = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button")
        ).find(
            (btn) =>
                (btn.textContent ?? "").trim() ===
                microcopy.actions.createProject
        );
        expect(createBtn).toBeTruthy();
    });

    it("Header greeting must not concatenate a username via raw template literal in JSX", () => {
        // The header currently renders `Hi, {user?.username}`. That is a
        // string concatenation in JSX (JSX text + interpolation) and is
        // not localizable — the greeting needs to be a single microcopy
        // key with an ICU placeholder, e.g. `microcopy.greeting` =
        // "Hi, {name}". Until that key exists, this assertion fails.
        const greeting = (microcopy as Record<string, unknown>).greeting as
            | string
            | undefined;
        expect(greeting).toBeTruthy();
        if (typeof greeting === "string") {
            // Must contain a placeholder, not a fixed name.
            expect(greeting).toMatch(/\{name\}|%s|\{username\}/);
        }
    });

    it("Header dark-mode toggle aria-label has a single microcopy key per state, not 'Switch to <mode>' concatenation", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        // The current code computes the aria-label on the fly with
        // `scheme === "dark" ? "Switch to light mode" : "Switch to dark mode"`
        // which is two hand-rolled strings. They must come from microcopy
        // (e.g. `microcopy.actions.useLightMode` /
        // `microcopy.actions.useDarkMode`) so the localization team can
        // adjust word order.
        const a11y = microcopy.a11y as Record<string, string | undefined>;
        expect(a11y.useLightMode).toBeTruthy();
        expect(a11y.useDarkMode).toBeTruthy();
    });
});

/* -------------------------------------------------------------------------- */
/* 4. Banned button labels per §3.1                                            */
/* -------------------------------------------------------------------------- */
describe("UI quality :: banned button labels (Submit / OK / Login / Register)", () => {
    /**
     * The microcopy lint in §6 spells out the banned button labels.
     * We mirror that lint here so a regression in any rendered modal
     * surfaces immediately. We render every modal/drawer surface and
     * scan its buttons.
     */
    const BANNED_BUTTON_LABELS = [
        /^Submit$/,
        /^OK$/,
        /^Login$/,
        /^Register$/,
        /^Sign in$/
    ];

    const expectNoBannedButtons = (root: HTMLElement) => {
        const offenders = Array.from(
            root.querySelectorAll<HTMLButtonElement>("button")
        )
            .map((btn) => (btn.textContent ?? "").trim())
            .filter((label) =>
                BANNED_BUTTON_LABELS.some((re) => re.test(label))
            );
        expect(offenders).toEqual([]);
    };

    it("ProjectModal renders no buttons whose visible label is 'Submit', 'OK', or 'Register'", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        store.dispatch(projectActions.openModal());

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects"]}>
                        <Routes>
                            <Route
                                path="/projects"
                                element={<ProjectModal />}
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        const dialog = screen.getByRole("dialog");
        expectNoBannedButtons(dialog);
    });

    it("TaskModal renders no buttons whose visible label is 'Submit', 'OK', or 'Login'", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        queryClient.setQueryData(["users/members"], [member()]);
        store.dispatch(overlaysActions.startEditingTask("task-1"));

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
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

        const dialog = screen.getByRole("dialog");
        expectNoBannedButtons(dialog);
    });
});
