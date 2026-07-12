/**
 * Form-validation contract tests:
 *
 *   - Required fields reject whitespace-only values.
 *   - String fields are persisted trimmed.
 *   - Register-side passwords have a minimum length.
 */
import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

import ProjectModal from "../components/projectModal";
import RegisterForm from "../components/registerForm";
import TaskModal from "../components/taskModal";
import { microcopy } from "../constants/microcopy";
import { store } from "../store";
import { projectActions } from "../store/reducers/projectModalSlice";
import useReactMutation from "../utils/hooks/useReactMutation";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTaskModal from "../utils/hooks/useTaskModal";

jest.mock("../utils/hooks/useReactMutation");
jest.mock("../utils/hooks/useReactQuery");
jest.mock("../utils/hooks/useTaskModal");
// Mirror the useTaskModal mock so the routed-panel sibling hook never
// reaches its real implementation when the modal route refactor adds an
// indirect dependency on it (R-C M3).
jest.mock("../utils/hooks/useTaskPanelNavigation", () => ({
    __esModule: true,
    default: () => ({ openTask: jest.fn(), closeTask: jest.fn() })
}));

const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;
const mockedUseReactQuery = useReactQuery as jest.MockedFunction<
    typeof useReactQuery
>;
const mockedUseTaskModal = useTaskModal as jest.MockedFunction<
    typeof useTaskModal
>;

const member: IMember = {
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice"
};

const taskFixture: ITask = {
    _id: "task-1",
    columnId: "column-1",
    coordinatorId: "member-1",
    epic: "Feature",
    index: 0,
    note: "No note",
    projectId: "project-1",
    storyPoints: 3,
    taskName: "Build task",
    type: "Task"
};

const stubMutation = (mutateAsync: jest.Mock) =>
    ({
        error: null,
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync
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
});

describe("ProjectModal field hygiene", () => {
    const mutateAsync = jest.fn();

    const renderOpen = () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                mutations: { retry: false },
                queries: { retry: false }
            }
        });
        return render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects?modal=on"]}>
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

    beforeEach(() => {
        jest.clearAllMocks();
        store.dispatch(projectActions.openModal());
        mutateAsync.mockResolvedValue({});
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));
        mockedUseReactQuery.mockImplementation((endpoint: string) =>
            endpoint === "users/members"
                ? stubQuery([member])
                : stubQuery(undefined)
        );
    });

    it("rejects a whitespace-only project name and never fires the create mutation", async () => {
        const user = userEvent.setup();
        renderOpen();
        await screen.findByRole("dialog");

        await user.type(screen.getByLabelText(/project name/i), "    ");
        await user.type(screen.getByLabelText(/organization/i), "Finance");
        await user.click(
            screen.getByRole("button", {
                name: microcopy.actions.createProject
            })
        );

        await waitFor(() => {
            expect(
                screen.getByText(microcopy.validation.projectNameRequired)
            ).toBeInTheDocument();
        });
        expect(mutateAsync).not.toHaveBeenCalled();
    });
});

describe("TaskModal field hygiene", () => {
    const mutateAsync = jest.fn();

    const renderOpen = () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        queryClient.setQueryData(["users/members"], [member]);
        return render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={<TaskModal tasks={[taskFixture]} />}
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mutateAsync.mockResolvedValue({});
        mockedUseTaskModal.mockReturnValue({
            closeModal: jest.fn(),
            editingTaskId: "task-1",
            startEditing: jest.fn()
        });
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));
        mockedUseReactQuery.mockImplementation(() => stubQuery([member]));
    });

    it("rejects a whitespace-only task name on Save", async () => {
        const user = userEvent.setup();
        renderOpen();
        const dialog = await screen.findByRole("dialog");

        const taskNameInput = screen.getByDisplayValue(
            "Build task"
        ) as HTMLInputElement;
        await user.clear(taskNameInput);
        await user.type(taskNameInput, "   ");

        const saveBtn = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button")
        ).find(
            (btn) => (btn.textContent ?? "").trim() === microcopy.actions.save
        );
        if (!saveBtn) throw new Error("Save button not found");
        await user.click(saveBtn);

        await waitFor(() => {
            expect(mutateAsync).not.toHaveBeenCalled();
        });
    });

    it("trims leading and trailing whitespace from the persisted task name", async () => {
        const user = userEvent.setup();
        renderOpen();
        const dialog = await screen.findByRole("dialog");

        const taskNameInput = screen.getByDisplayValue(
            "Build task"
        ) as HTMLInputElement;
        await user.clear(taskNameInput);
        await user.type(taskNameInput, "   Plan v2 release   ");

        const saveBtn = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button")
        ).find(
            (btn) => (btn.textContent ?? "").trim() === microcopy.actions.save
        );
        if (!saveBtn) throw new Error("Save button not found");
        await user.click(saveBtn);

        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalled();
        });
        const last = mutateAsync.mock.calls.at(-1)?.[0] as
            | { taskName?: string }
            | undefined;
        expect(last?.taskName).toBe("Plan v2 release");
    });
});

describe("RegisterForm hygiene", () => {
    const mutateAsync = jest.fn();

    const renderForm = () => {
        mockedUseReactMutation.mockReturnValue(stubMutation(mutateAsync));
        render(
            <BrowserRouter>
                <RegisterForm onError={jest.fn()} />
            </BrowserRouter>
        );
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mutateAsync.mockResolvedValue({});
    });

    it("rejects a whitespace-only username so we never persist a blank profile", async () => {
        const user = userEvent.setup();
        renderForm();

        await user.type(screen.getByLabelText(/^email$/i), "alice@example.com");
        await user.type(screen.getByLabelText(/^username$/i), "   ");
        await user.type(screen.getByLabelText(/^password$/i), "longenough");
        await user.click(
            screen.getByRole("button", { name: microcopy.actions.signUp })
        );

        await waitFor(() => {
            expect(mutateAsync).not.toHaveBeenCalled();
        });
    });

    it("rejects a 4-character password — Register must enforce a minimum length", async () => {
        const user = userEvent.setup();
        renderForm();

        await user.type(screen.getByLabelText(/^email$/i), "alice@example.com");
        await user.type(screen.getByLabelText(/^username$/i), "alice");
        await user.type(screen.getByLabelText(/^password$/i), "abcd");
        await user.click(
            screen.getByRole("button", { name: microcopy.actions.signUp })
        );

        await waitFor(() => {
            expect(mutateAsync).not.toHaveBeenCalled();
        });
    });

    it("trims leading/trailing whitespace from the email before submitting", async () => {
        const user = userEvent.setup();
        renderForm();

        await user.type(
            screen.getByLabelText(/^email$/i),
            "  alice@example.com  "
        );
        await user.type(screen.getByLabelText(/^username$/i), "alice");
        await user.type(screen.getByLabelText(/^password$/i), "longenough");
        await user.click(
            screen.getByRole("button", { name: microcopy.actions.signUp })
        );

        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalled();
        });
        const last = mutateAsync.mock.calls.at(-1)?.[0] as
            | { email?: string }
            | undefined;
        expect(last?.email).toBe("alice@example.com");
    });
});
