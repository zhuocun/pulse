import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";

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
    const { closeModal, editingProject, isLoading, openModal, startEditing } =
        useProjectModal();
    const location = useLocation();

    return (
        <div>
            <span data-testid="search">{location.search}</span>
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

/** Simulates `ProjectPage` / `ProjectList` calling `openModal` while `ProjectModal` reads `isModalOpened`. */
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

const renderProjectModalProbe = (route: string) =>
    render(
        <Provider store={store}>
            <MemoryRouter initialEntries={[route]}>
                <ProjectModalProbe />
            </MemoryRouter>
        </Provider>
    );

const renderSplitModalConsumers = (route: string) =>
    render(
        <Provider store={store}>
            <MemoryRouter initialEntries={[route]}>
                <ProjectModalOpener />
                <ProjectModalObserver />
            </MemoryRouter>
        </Provider>
    );

describe("useProjectModal", () => {
    beforeEach(() => {
        store.dispatch(projectActions.closeModal());
        mockedUseReactQuery.mockReset();
        mockedUseReactQuery.mockReturnValue(queryResult());
    });

    afterEach(() => {
        store.dispatch(projectActions.closeModal());
    });

    it("opens the Redux modal flag when modal=on is present", async () => {
        renderProjectModalProbe("/projects?modal=on");

        await waitFor(() =>
            expect(store.getState().projectModal.isModalOpened).toBe(true)
        );
    });

    it("opens the modal and fetches the editing project when editingProjectId is present", async () => {
        mockedUseReactQuery.mockReturnValue(
            queryResult({
                data: project(),
                isLoading: true
            })
        );

        renderProjectModalProbe("/projects?editingProjectId=p1");

        await waitFor(() =>
            expect(store.getState().projectModal.isModalOpened).toBe(true)
        );
        expect(mockedUseReactQuery).toHaveBeenCalledWith(
            "projects",
            { projectId: "p1" },
            "editingProject",
            undefined,
            undefined,
            true
        );
        expect(screen.getByTestId("project")).toHaveTextContent("Roadmap");
        expect(screen.getByTestId("loading")).toHaveTextContent("loading");
    });

    it("closes the modal when neither modal param is present", async () => {
        store.dispatch(projectActions.openModal());

        renderProjectModalProbe("/projects");

        await waitFor(() =>
            expect(store.getState().projectModal.isModalOpened).toBe(false)
        );
        expect(mockedUseReactQuery).toHaveBeenCalledWith(
            "projects",
            { projectId: null },
            "editingProject",
            undefined,
            undefined,
            false
        );
    });

    it("keeps `isModalOpened` in sync across separate `useProjectModal` instances (page vs modal shell)", () => {
        renderSplitModalConsumers("/projects");

        expect(screen.getByTestId("remote-modal-open")).toHaveTextContent("no");
        fireEvent.click(screen.getByRole("button", { name: "remote-open" }));
        expect(screen.getByTestId("remote-modal-open")).toHaveTextContent(
            "yes"
        );
    });

    it("writes modal and editing params without dropping existing query state, then removes them on close", async () => {
        renderProjectModalProbe("/projects");

        fireEvent.click(screen.getByRole("button", { name: "open" }));

        await waitFor(() =>
            expect(screen.getByTestId("search")).toHaveTextContent("?modal=on")
        );

        fireEvent.click(screen.getByRole("button", { name: "edit" }));

        await waitFor(() =>
            expect(screen.getByTestId("search")).toHaveTextContent(
                "?modal=on&editingProjectId=p2"
            )
        );

        fireEvent.click(screen.getByRole("button", { name: "close" }));

        await waitFor(() =>
            expect(screen.getByTestId("search")).toHaveTextContent("")
        );
        await waitFor(() =>
            expect(store.getState().projectModal.isModalOpened).toBe(false)
        );
    });
});
