import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";

import useProjectModal from "../../utils/hooks/useProjectModal";
import useReactQuery from "../../utils/hooks/useReactQuery";

import ProjectPopover from ".";

jest.mock("../../utils/hooks/useProjectModal");
jest.mock("../../utils/hooks/useReactQuery");

const mockedUseProjectModal = useProjectModal as jest.MockedFunction<
    typeof useProjectModal
>;
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

const installBrowserMocks = () => {
    class ResizeObserverMock {
        observe = jest.fn();

        unobserve = jest.fn();

        disconnect = jest.fn();
    }

    Object.defineProperty(window, "ResizeObserver", {
        writable: true,
        value: ResizeObserverMock
    });

    // Radix Popover drives its surface with pointer-capture APIs jsdom
    // doesn't ship; polyfill them so the switcher can open.
    Element.prototype.scrollIntoView = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.releasePointerCapture = jest.fn();
};

const renderProjectPopover = () => {
    const openModal = jest.fn();

    mockedUseProjectModal.mockReturnValue({
        closeModal: jest.fn(),
        editingProject: undefined,
        isLoading: false,
        isModalOpened: false,
        openModal,
        startEditing: jest.fn()
    } as ReturnType<typeof useProjectModal>);
    mockedUseReactQuery.mockReturnValue({
        data: [
            project(),
            project({
                _id: "p2",
                projectName: "Billing"
            })
        ]
    } as unknown as ReturnType<typeof useReactQuery<IProject[]>>);

    window.history.pushState({}, "Projects", "/projects");

    // The switcher rows warm board queries on hover via
    // `usePrefetchProject` → `useQueryClient()` (not mocked here), so a
    // real `QueryClientProvider` must wrap the tree.
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });

    render(
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                <ProjectPopover />
            </BrowserRouter>
        </QueryClientProvider>
    );

    return { openModal };
};

describe("ProjectPopover", () => {
    beforeAll(() => {
        installBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    const openSwitcher = async () => {
        const user = userEvent.setup();
        await user.click(
            screen.getByRole("button", { name: /switch project/i })
        );
        return user;
    };

    it("shows projects and navigates to a selected project", async () => {
        renderProjectPopover();

        const user = await openSwitcher();
        await user.click(await screen.findByText("Roadmap"));

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects/p1");
        });
    });

    it("opens the project modal from the create action", async () => {
        const { openModal } = renderProjectPopover();

        const user = await openSwitcher();
        await user.click(
            await screen.findByRole("button", { name: /create project/i })
        );

        expect(openModal).toHaveBeenCalledTimes(1);
    });
});
