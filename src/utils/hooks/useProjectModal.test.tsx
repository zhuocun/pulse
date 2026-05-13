import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { store } from "../../store";
import { projectActions } from "../../store/reducers/projectModalSlice";

import useProjectModal from "./useProjectModal";
import useReactQuery from "./useReactQuery";

jest.mock("./useReactQuery");

const mockedUseReactQuery = useReactQuery as jest.MockedFunction<
    typeof useReactQuery
>;

const project = (overrides: Partial<IProject> = {}): IProject => ({
    _id: "p1",
    createdAt: "2026-04-25T00:00:00.000Z",
    managerId: "u1",
    organization: "Product",
    projectName: "Roadmap",
    ...overrides
});

const queryResult = (overrides: Record<string, unknown> = {}) =>
    ({
        data: undefined,
        isLoading: false,
        ...overrides
    }) as unknown as ReturnType<typeof useReactQuery<IProject>>;

const ProjectModalProbe = () => {
    const {
        closeModal,
        editingProject,
        isLoading,
        isModalOpened,
        openModal,
        startEditing
    } = useProjectModal();

    return (
        <div>
            <span data-testid="isModalOpened">
                {isModalOpened ? "yes" : "no"}
            </span>
            <span data-testid="project">
                {editingProject?.projectName ?? "none"}
            </span>
            <span data-testid="loading">
                {isLoading ? "loading" : "loaded"}
            </span>
            <button type="button" onClick={openModal}>
                open
            </button>
            <button type="button" onClick={() => startEditing("p2")}>
                edit
            </button>
            <button type="button" onClick={closeModal}>
                close
            </button>
        </div>
    );
};

/** Simulates `ProjectPage` calling `openModal` while `ProjectModal` reads `isModalOpened`. */
const ProjectModalOpener = () => {
    const { openModal } = useProjectModal();
    return (
        <button type="button" onClick={openModal}>
            remote-open
        </button>
    );
};

const ProjectModalObserver = () => {
    const { isModalOpened } = useProjectModal();
    return (
        <span data-testid="remote-modal-open">
            {isModalOpened ? "yes" : "no"}
        </span>
    );
};

const renderProjectModalProbe = () =>
    render(
        <Provider store={store}>
            <MemoryRouter>
                <ProjectModalProbe />
            </MemoryRouter>
        </Provider>
    );

const renderSplitModalConsumers = () =>
    render(
        <Provider store={store}>
            <MemoryRouter>
                <ProjectModalOpener />
                <ProjectModalObserver />
            </MemoryRouter>
        </Provider>
    );

describe("useProjectModal (Redux-only)", () => {
    beforeEach(() => {
        store.dispatch(projectActions.closeModal());
        mockedUseReactQuery.mockReset();
        mockedUseReactQuery.mockReturnValue(queryResult());
    });

    afterEach(() => {
        store.dispatch(projectActions.closeModal());
    });

    it("openModal flips the Redux modal flag and the consumer-visible state synchronously", () => {
        renderProjectModalProbe();

        expect(screen.getByTestId("isModalOpened")).toHaveTextContent("no");

        fireEvent.click(screen.getByRole("button", { name: "open" }));

        expect(screen.getByTestId("isModalOpened")).toHaveTextContent("yes");
        expect(store.getState().projectModal.isModalOpened).toBe(true);
    });

    it("startEditing sets editingProjectId and opens the modal, fetching the project", () => {
        mockedUseReactQuery.mockReturnValue(
            queryResult({ data: project(), isLoading: true })
        );

        renderProjectModalProbe();

        fireEvent.click(screen.getByRole("button", { name: "edit" }));

        expect(store.getState().projectModal.isModalOpened).toBe(true);
        expect(store.getState().projectModal.editingProjectId).toBe("p2");
        expect(mockedUseReactQuery).toHaveBeenCalledWith(
            "projects",
            { projectId: "p2" },
            "editingProject",
            undefined,
            undefined,
            true
        );
        expect(screen.getByTestId("project")).toHaveTextContent("Roadmap");
        expect(screen.getByTestId("loading")).toHaveTextContent("loading");
    });

    it("closeModal clears the editing id and closes the modal", () => {
        renderProjectModalProbe();

        fireEvent.click(screen.getByRole("button", { name: "edit" }));
        expect(store.getState().projectModal.isModalOpened).toBe(true);
        expect(store.getState().projectModal.editingProjectId).toBe("p2");

        fireEvent.click(screen.getByRole("button", { name: "close" }));

        expect(store.getState().projectModal.isModalOpened).toBe(false);
        expect(store.getState().projectModal.editingProjectId).toBe(null);
    });

    it("keeps `isModalOpened` in sync across separate `useProjectModal` instances", () => {
        renderSplitModalConsumers();

        expect(screen.getByTestId("remote-modal-open")).toHaveTextContent("no");
        fireEvent.click(screen.getByRole("button", { name: "remote-open" }));
        expect(screen.getByTestId("remote-modal-open")).toHaveTextContent(
            "yes"
        );
    });

    /*
     * Regression for the iOS Safari "click doesn't open" report. The
     * synchronous Redux dispatch inside `openModal` must flip the
     * observer in the very next render, with no `waitFor`. If the open
     * flag is bound to URL re-propagation, this is the test that fails.
     */
    it("flips a sibling observer's `isModalOpened` synchronously with the click", () => {
        renderSplitModalConsumers();

        expect(screen.getByTestId("remote-modal-open")).toHaveTextContent("no");

        fireEvent.click(screen.getByRole("button", { name: "remote-open" }));

        expect(screen.getByTestId("remote-modal-open")).toHaveTextContent(
            "yes"
        );
        expect(store.getState().projectModal.isModalOpened).toBe(true);
    });
});
