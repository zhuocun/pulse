/**
 * Strict copy/microcopy consistency tests (TDD harness).
 *
 * The optimization plan §3.1 mandates that every visible string come from
 * `src/constants/microcopy.ts`, so casing, action verbs, and confirmation
 * prompts stay aligned across surfaces. These tests pin down each surface
 * that should use the central bundle. A failing test means the surface is
 * still hand-rolling its strings and needs to be migrated.
 */
import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import ProjectModal from "../components/projectModal";
import TaskModal from "../components/taskModal";
import { microcopy } from "../constants/microcopy";
import { store } from "../store";
import { projectActions } from "../store/reducers/projectModalSlice";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useReactMutation from "../utils/hooks/useReactMutation";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTaskModal from "../utils/hooks/useTaskModal";

jest.mock("../utils/hooks/useTaskModal");
jest.mock("../utils/hooks/useReactMutation");
jest.mock("../utils/hooks/useReactQuery");
jest.mock("../utils/hooks/useAiEnabled");

const mockedUseTaskModal = useTaskModal as jest.MockedFunction<
    typeof useTaskModal
>;
const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;
const mockedUseReactQuery = useReactQuery as jest.MockedFunction<
    typeof useReactQuery
>;
const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
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

const installCommonMocks = () => {
    mockedUseReactMutation.mockReturnValue(stubMutation());
    // Default: any query returns the member list. Tests that need a
    // specific query to be empty (e.g. ProjectModal not editing) override
    // this with mockedUseReactQuery.mockImplementation(...).
    mockedUseReactQuery.mockImplementation((endpoint: string) => {
        if (endpoint === "projects") {
            return stubQuery(undefined);
        }
        return stubQuery([member()]);
    });
    mockedUseAiEnabled.mockReturnValue({
        available: false,
        enabled: false,
        setEnabled: jest.fn()
    });
};

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
                        <Route path="/projects" element={<ProjectModal />} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

const renderTaskModalOpen = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });

    queryClient.setQueryData(["users/members"], [member()]);

    mockedUseTaskModal.mockReturnValue({
        closeModal: jest.fn(),
        editingTaskId: "task-1",
        startEditing: jest.fn()
    });

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

beforeAll(() => {
    installAntdBrowserMocks();
});

beforeEach(() => {
    jest.clearAllMocks();
    installCommonMocks();
});

describe("UI quality :: ProjectModal microcopy", () => {
    /**
     * Modal title for create / edit is hand-rolled in
     * `projectModal/index.tsx`. Promote to microcopy so casing stays
     * consistent across surfaces.
     */
    it("uses microcopy.actions.createProject for the Create modal title", () => {
        renderProjectModalOpen();

        expect(
            screen.getByRole("dialog", {
                name: microcopy.actions.createProject
            })
        ).toBeInTheDocument();
    });

    it("uses Save / Create — never 'Submit' or 'OK' — for the modal confirm button", () => {
        renderProjectModalOpen();

        const dialog = screen.getByRole("dialog");
        const buttonsInDialog = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button")
        ).map((btn) => (btn.textContent ?? "").trim());

        expect(buttonsInDialog).not.toContain("OK");
        expect(buttonsInDialog).not.toContain("Submit");
    });

    it("project-name validation message comes from microcopy.validation.projectNameRequired", () => {
        // Source-of-truth check: the validation message must be defined
        // in the central bundle so the rule and the test point at the
        // same string.
        expect(microcopy.validation.projectNameRequired).toBe(
            "Please enter the project name"
        );
    });
});

describe("UI quality :: TaskModal microcopy", () => {
    /**
     * TaskModal currently hard-codes the validation strings:
     *   - "Please enter the task name"
     *   - "Please select a coordinator"
     *   - "Please select the task type"
     * They should be promoted into `microcopy.validation.*` so other
     * surfaces can reuse them and casing stays consistent.
     */
    const REQUIRED_VALIDATION_KEYS = [
        "taskNameRequired",
        "coordinatorRequired",
        "taskTypeRequired"
    ] as const;

    it.each(REQUIRED_VALIDATION_KEYS)(
        "exposes microcopy.validation.%s for the task form",
        (key) => {
            const validation = microcopy.validation as Record<
                string,
                string | undefined
            >;
            expect(validation[key]).toBeTruthy();
        }
    );

    it("uses Save (microcopy.actions.save) — never 'OK' or 'Submit' — for the confirm button", () => {
        renderTaskModalOpen();

        const dialog = screen.getByRole("dialog");
        const okBtn = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button")
        ).find(
            (btn) => (btn.textContent ?? "").trim() === microcopy.actions.save
        );
        expect(okBtn).toBeTruthy();
    });

    it("title uses microcopy (Edit task) — not the hand-rolled 'Edit Task' casing", () => {
        renderTaskModalOpen();

        // Sentence case per §3.1 of the optimization plan: "Edit task"
        // not "Edit Task". Promoting the title into microcopy guarantees
        // the casing stays consistent across surfaces (board cards,
        // modal, task drawer).
        const editKey = (
            microcopy.actions as Record<string, string | undefined>
        ).editTask;
        expect(editKey).toBeTruthy();
        if (editKey) {
            const dialog = screen.getByRole("dialog");
            expect(dialog).toHaveTextContent(editKey);
        }
    });
});
