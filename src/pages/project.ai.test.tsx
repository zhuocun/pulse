import {
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from "@testing-library/react";
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
        aiUseLocalEngine: true
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

    it("opens the Ask drawer and runs semantic project search", async () => {
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

        fireEvent.click(
            screen.getByRole("button", { name: /ask board copilot/i })
        );

        expect(
            await screen.findByLabelText("Message Board Copilot")
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

    it("sends a chat message from the project list drawer", async () => {
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

        fireEvent.click(
            screen.getByRole("button", { name: /ask board copilot/i })
        );

        const messageInput = await screen.findByLabelText(
            "Message Board Copilot"
        );
        fireEvent.change(messageInput, {
            target: { value: "List all projects" }
        });
        fireEvent.click(screen.getByRole("button", { name: /send message/i }));

        await waitFor(() => {
            const drawer = document.querySelector(".ant-drawer-open");
            expect(
                drawer?.querySelector('[data-testid="chat-tool-payload-block"]')
            ).toBeTruthy();
        });
        const drawerEl = document.querySelector(".ant-drawer-open");
        expect(drawerEl).toBeTruthy();
        const toolBlock = drawerEl!.querySelector(
            '[data-testid="chat-tool-payload-block"]'
        );
        expect(toolBlock?.textContent ?? "").toMatch(/Checked projects/i);
        fireEvent.click(
            within(drawerEl as HTMLElement).getByRole("button", {
                name: /show details/i
            })
        );

        const drawerClose = document.querySelector(
            ".ant-drawer-open .ant-drawer-close"
        ) as HTMLElement | null;
        expect(drawerClose).toBeTruthy();
        fireEvent.click(drawerClose!);

        await waitFor(() => {
            expect(
                document.querySelector(".ant-drawer-open")
            ).not.toBeInTheDocument();
        });
    });
});
