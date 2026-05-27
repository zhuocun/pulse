import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "../App";
import { microcopy } from "../constants/microcopy";
import AppProviders from "../utils/appProviders";

// Lazy route loading + multi-step navigation chains (login → projects →
// board → drawer) push these end-to-end flows past the 5s default,
// especially under jest parallelism. 60s gives enough headroom on slow CI
// when other suites are competing for the worker pool.
jest.setTimeout(60000);

jest.mock("../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "http://localhost:8080/api/v1",
        aiBaseUrl: "",
        aiEnabled: false,
        aiUseLocalEngine: true,
        // Phase 3 A3 — phone chassis. Default ON matches production
        // so the bottom-tab bar mounts when matchMedia resolves to
        // `(pointer: coarse)` (the mobile regression test below).
        bottomNavEnabled: true
    }
}));

type DragDropContextMockProps = {
    children: ReactNode;
    onDragEnd?: unknown;
};

type DraggableProvidedMock = {
    dragHandleProps: Record<string, string>;
    draggableProps: Record<string, string | number>;
    innerRef: jest.Mock;
};

type DraggableMockProps = {
    children: (provided: DraggableProvidedMock) => ReactNode;
    draggableId: string;
    index: number;
    isDragDisabled?: boolean;
};

type DroppableProvidedMock = {
    droppableProps: Record<string, string>;
    innerRef: jest.Mock;
    placeholder: ReactNode;
};

type DroppableMockProps = {
    children: (provided: DroppableProvidedMock) => ReactNode;
    droppableId: string;
};

jest.mock("@hello-pangea/dnd", () => {
    const React = jest.requireActual("react");

    return {
        DragDropContext: ({
            children,
            onDragEnd
        }: DragDropContextMockProps) => (
            <div data-has-drag-end={String(Boolean(onDragEnd))}>{children}</div>
        ),
        Draggable: ({
            children,
            draggableId,
            index,
            isDragDisabled
        }: DraggableMockProps) =>
            children({
                dragHandleProps: {
                    "data-drag-handle-id": draggableId
                },
                draggableProps: {
                    "data-drag-disabled": String(Boolean(isDragDisabled)),
                    "data-draggable-id": draggableId,
                    "data-draggable-index": index
                },
                innerRef: jest.fn()
            }),
        Droppable: ({ children, droppableId }: DroppableMockProps) =>
            children({
                droppableProps: {
                    "data-droppable-id": droppableId
                },
                innerRef: jest.fn(),
                placeholder: React.createElement("span", {
                    "data-testid": `placeholder-${droppableId}`
                })
            })
    };
});

const mockJsonResponse = (body: unknown, ok = true, status = ok ? 200 : 400) =>
    Promise.resolve({
        ok,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body))
    } as Response);

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "u1",
    username: "Alice",
    email: "alice@example.com",
    ...overrides
});

const testProject = (overrides: Partial<IProject> = {}): IProject => ({
    _id: "p1",
    projectName: "Alpha",
    managerId: "u1",
    organization: "Eng",
    createdAt: "2026-04-25T00:00:00.000Z",
    ...overrides
});

const testColumn = (overrides: Partial<IColumn> = {}): IColumn => ({
    _id: "c1",
    columnName: "Todo",
    projectId: "p1",
    index: 0,
    ...overrides
});

const testTask = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "t1",
    columnId: "c1",
    coordinatorId: "u1",
    epic: "E1",
    taskName: "First task",
    type: "story",
    note: "",
    projectId: "p1",
    storyPoints: 1,
    index: 0,
    ...overrides
});

const testUser = (): IUser => ({
    ...member(),
    likedProjects: []
});

describe("App integration (full providers + routes)", () => {
    const fetchMock = global.fetch as jest.Mock;

    const renderAppAt = (path: string) => {
        window.history.pushState({}, "Integration", path);
        return render(
            <AppProviders>
                <App />
            </AppProviders>
        );
    };

    beforeAll(() => {
        process.env.REACT_APP_API_URL = "http://localhost:8080";
        process.env.REACT_APP_AI_ENABLED = "false";
    });

    beforeEach(() => {
        fetchMock.mockReset();
        localStorage.clear();
        sessionStorage.clear();
        for (const part of document.cookie.split(";")) {
            const name = part.split("=")[0]?.trim();
            if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
        }
        window.history.pushState({}, "Reset", "/");
    });

    // Stateful session mock: ``GET /users`` 401s before login (the
    // ``AuthProvider`` probe sees an empty cache and the route guard
    // sends the visitor to /login), then 200s with the user record
    // once ``POST /auth/login`` succeeds -- mirroring the cookie
    // path's "the browser carries the HttpOnly Token cookie now"
    // handshake without needing jsdom to actually honor Set-Cookie.
    const setupAuthenticatedSessionMocks = () => {
        const user = testUser();
        const proj = testProject();
        const col = testColumn();
        const task = testTask();
        let loggedIn = false;

        fetchMock.mockImplementation((input: RequestInfo) => {
            const url = typeof input === "string" ? input : input.url;
            const u = new URL(url);
            const path = u.pathname;

            if (path.endsWith("/auth/login")) {
                loggedIn = true;
                return mockJsonResponse(user);
            }
            if (path.endsWith("/auth/logout")) {
                loggedIn = false;
                return mockJsonResponse(null, true, 204);
            }
            if (path.endsWith("/users") && !path.includes("/members")) {
                if (!loggedIn) {
                    return mockJsonResponse({ error: "empty JWT" }, false, 401);
                }
                return mockJsonResponse(user);
            }
            if (path.endsWith("/users/members")) {
                return mockJsonResponse([member()]);
            }
            if (path.endsWith("/projects")) {
                const projectId = u.searchParams.get("projectId");
                if (projectId === "p1") {
                    return mockJsonResponse(proj);
                }
                return mockJsonResponse([proj]);
            }
            if (path.endsWith("/boards")) {
                return mockJsonResponse([col]);
            }
            if (path.endsWith("/tasks")) {
                return mockJsonResponse([task]);
            }

            return mockJsonResponse({ error: `Unhandled: ${url}` }, false, 404);
        });

        return { user, proj, col, task };
    };

    it("redirects / to /login and shows the login screen", async () => {
        setupAuthenticatedSessionMocks();
        renderAppAt("/");

        await waitFor(
            () => {
                expect(window.location.pathname).toBe("/login");
            },
            { timeout: 5000 }
        );

        expect(
            await screen.findByRole(
                "heading",
                {
                    name: /log in to your account/i
                },
                { timeout: 5000 }
            )
        ).toBeInTheDocument();
    });

    it("renders the forgot-password placeholder route for anonymous visitors", async () => {
        renderAppAt("/auth/forgot-password");

        expect(
            await screen.findByRole("heading", {
                name: /reset your password/i
            })
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                /password reset is coming soon\. please contact your workspace admin if you need immediate access\./i
            )
        ).toBeInTheDocument();
        expect(window.location.pathname).toBe("/auth/forgot-password");
    });

    it("logs in and navigates to the project list with live data", async () => {
        setupAuthenticatedSessionMocks();
        const user = userEvent.setup();
        renderAppAt("/login");

        await user.type(
            await screen.findByLabelText(/^email$/i, undefined, {
                timeout: 5000
            }),
            "alice@example.com"
        );
        await user.type(screen.getByLabelText(/^password$/i), "secret");
        await user.click(screen.getByRole("button", { name: /^log in$/i }));

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects");
        });

        // The REST JWT now rides an HttpOnly cookie that JS cannot
        // read, so the previous ``localStorage.getItem("Token")``
        // assertion is meaningless. The route-level transition is
        // the observable proof that auth landed.

        expect(
            await screen.findByRole(
                "heading",
                { name: /^projects$/i, level: 1 },
                { timeout: 5000 }
            )
        ).toBeInTheDocument();

        expect(
            await screen.findByRole(
                "link",
                { name: "Alpha" },
                { timeout: 5000 }
            )
        ).toBeInTheDocument();

        const loginCalls = fetchMock.mock.calls.filter(([req]) =>
            (typeof req === "string" ? req : req.url).includes("/auth/login")
        );
        expect(loginCalls.length).toBeGreaterThanOrEqual(1);
    }, 20000);

    it("opens the board for a project from the list", async () => {
        setupAuthenticatedSessionMocks();
        const user = userEvent.setup();
        renderAppAt("/login");

        await user.type(
            await screen.findByLabelText(/^email$/i, undefined, {
                timeout: 5000
            }),
            "alice@example.com"
        );
        await user.type(screen.getByLabelText(/^password$/i), "secret");
        await user.click(screen.getByRole("button", { name: /^log in$/i }));

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects");
        });

        await user.click(
            await screen.findByRole(
                "link",
                { name: "Alpha" },
                { timeout: 5000 }
            )
        );

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects/p1/board");
        });

        expect(
            await screen.findByRole(
                "heading",
                { name: /alpha board/i },
                { timeout: 5000 }
            )
        ).toBeInTheDocument();

        expect(
            await screen.findByText("First task", {}, { timeout: 5000 })
        ).toBeInTheDocument();
    }, 20000);

    it("logs out from the header and returns to login", async () => {
        setupAuthenticatedSessionMocks();
        const user = userEvent.setup();
        renderAppAt("/login");

        await user.type(
            await screen.findByLabelText(/^email$/i, undefined, {
                timeout: 5000
            }),
            "alice@example.com"
        );
        await user.type(screen.getByLabelText(/^password$/i), "secret");
        await user.click(screen.getByRole("button", { name: /^log in$/i }));

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects");
        });

        await user.click(
            await screen.findByRole(
                "button",
                {
                    name: /account menu for alice/i
                },
                { timeout: 5000 }
            )
        );

        await user.click(
            await screen.findByRole(
                "button",
                { name: /^log out$/i },
                { timeout: 5000 }
            )
        );

        await waitFor(() => {
            expect(window.location.pathname).toBe("/login");
        });
        // No ``localStorage.getItem("Token")`` check -- the REST JWT
        // lives in an HttpOnly cookie that ``POST /auth/logout``
        // cleared at the backend. The route transition back to
        // ``/login`` is the user-visible signal.
    }, 20000);

    /*
     * Regression: BottomTabBar from board page.
     *
     * User report: clicking a bottom-tab on a coarse-pointer viewport
     * while the user is on `/projects/:projectId/board` updated the
     * URL but the page stayed on the board until refresh. The bar now
     * uses idiomatic react-router NavLink navigation, so the route
     * swaps client-side and the new view renders without a refresh.
     */
    it("clicking a BottomTabBar tab from the board page navigates to the new view (mobile)", async () => {
        // Coarse pointer signals phone chrome — the bar mounts, the
        // header right-cluster demotes. Width queries return false so
        // AntD's Grid.useBreakpoint reads as phone. setupTests defines
        // matchMedia with writable: true so we update via assignment
        // rather than another defineProperty.
        (
            window as Window & { matchMedia: typeof window.matchMedia }
        ).matchMedia = ((query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: query === "(pointer: coarse)",
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })) as unknown as typeof window.matchMedia;

        setupAuthenticatedSessionMocks();
        const user = userEvent.setup();
        renderAppAt("/login");

        // Establish the auth session first so RequireAuth lets the
        // board route render — the stateful mock 401s `/users` until
        // `/auth/login` flips its flag.
        await user.type(
            await screen.findByLabelText(/^email$/i, undefined, {
                timeout: 5000
            }),
            "alice@example.com"
        );
        await user.type(screen.getByLabelText(/^password$/i), "secret");
        await user.click(screen.getByRole("button", { name: /^log in$/i }));

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects");
        });

        // Now navigate to the board — the projects list is showing
        // because that's where login lands.
        await user.click(
            await screen.findByRole(
                "link",
                { name: "Alpha" },
                { timeout: 5000 }
            )
        );

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects/p1/board");
        });

        // Wait for the board to render — the heading proves the
        // ProjectDetailPage + BoardPage tree resolved.
        expect(
            await screen.findByRole(
                "heading",
                { name: /alpha board/i },
                { timeout: 5000 }
            )
        ).toBeInTheDocument();

        // Click the Inbox tab in the bottom tab bar.
        const inboxLink = await screen.findByRole(
            "link",
            { name: new RegExp(`^${microcopy.nav.tabs.inbox}$`, "i") },
            { timeout: 5000 }
        );
        await user.click(inboxLink);

        // URL updates AND the inbox page surfaces — the bug presented
        // as the URL changing without the new view rendering.
        await waitFor(() => {
            expect(window.location.pathname).toBe("/inbox");
        });
        expect(
            await screen.findByTestId("inbox-empty-state", undefined, {
                timeout: 5000
            })
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("heading", { name: /alpha board/i })
        ).not.toBeInTheDocument();
    }, 30000);
});
