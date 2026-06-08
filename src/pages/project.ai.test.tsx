import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { store } from "../store";
import { projectActions } from "../store/reducers/projectModalSlice";

import ProjectPage from "./project";

jest.mock("../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "http://localhost:8080/api/v1",
        aiBaseUrl: "",
        aiEnabled: true,
        aiUseLocalEngine: true,
        copilotDockEnabled: true
    }
}));

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const project = (overrides: Partial<IProject> = {}): IProject => ({
    _id: "project-1",
    createdAt: "2026-04-25T00:00:00.000Z",
    managerId: "member-1",
    organization: "Product Engineering",
    projectName: "Roadmap Alpha",
    ...overrides
});

const members = [member()];
const projects = [
    project(),
    project({
        _id: "project-2",
        projectName: "Billing Portal",
        organization: "Finance"
    })
];

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

const installAntdBrowserMocks = () => {
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

describe("ProjectPage with Board Copilot enabled", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        localStorage.clear();
        store.dispatch(projectActions.closeModal());
        fetchMock.mockReset();
        fetchMock.mockImplementation((input) => {
            const url = String(input);
            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects")) {
                return Promise.resolve(response(projects));
            }
            return Promise.resolve(response({}));
        });
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    /*
     * PRD-GAP-006: the project-list AI chat surface is no longer a
     * standalone `<AiChatDrawer>` mounted on the page — the launcher just
     * flips the chat-drawer Redux flag, which `CopilotDockHost`'s bridge
     * forwards to the persistent dock once the user lands on a board
     * (the chat send / tool-payload flow is covered by
     * `copilotDock/*.test.tsx`). The project page's own AI surface is the
     * semantic project search in the search panel, asserted below.
     */
    it("runs semantic project search from the search panel", async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                mutations: { retry: false },
                queries: { retry: false }
            }
        });

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects"]}>
                        <Routes>
                            <Route path="/projects" element={<ProjectPage />} />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        expect(await screen.findByText("Roadmap Alpha")).toBeInTheDocument();

        // The "Ask Board Copilot" launcher remains on the toolbar.
        expect(
            screen.getByRole("button", { name: /ask board copilot/i })
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", {
                name: /toggle ai smart search/i
            })
        );

        fireEvent.change(
            screen.getByRole("textbox", { name: /Find related projects/i }),
            {
                target: { value: "billing finance" }
            }
        );
        fireEvent.click(
            screen.getByRole("button", { name: /Find related projects/i })
        );

        await waitFor(() => {
            expect(screen.getByText("Billing Portal")).toBeInTheDocument();
            expect(screen.queryByText("Roadmap Alpha")).not.toBeInTheDocument();
        });
    });
});
