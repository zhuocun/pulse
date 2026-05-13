import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "../App";
import { store } from "../store";
import { overlaysActions } from "../store/reducers/overlaysSlice";
import { projectActions } from "../store/reducers/projectModalSlice";
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
        aiEnabled: true,
        aiUseLocalEngine: true
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
        json: () => Promise.resolve(body)
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
    likedProjects: [],
    jwt: "jwt-board-ai"
});

describe("Board AI integration (App + local engine)", () => {
    // Each test simulates a full login → navigate → interact flow with
    // `userEvent.type`, which is intentionally slow. Bump the per-test
    // timeout so the suite stays green on slower CI workers.
    jest.setTimeout(20000);
    const fetchMock = global.fetch as jest.Mock;

    const renderAppAt = (path: string) => {
        window.history.pushState({}, "Board AI", path);
        return render(
            <AppProviders>
                <App />
            </AppProviders>
        );
    };

    beforeAll(() => {
        process.env.REACT_APP_API_URL = "http://localhost:8080";
        process.env.REACT_APP_AI_ENABLED = "true";
    });

    beforeEach(() => {
        fetchMock.mockReset();
        localStorage.clear();
        window.history.pushState({}, "Reset", "/");
        store.dispatch(overlaysActions.closeChatDrawer());
        store.dispatch(overlaysActions.closeBoardBrief());
        store.dispatch(overlaysActions.closeTaskModal());
        store.dispatch(overlaysActions.closeAiDraft());
        store.dispatch(projectActions.closeModal());
    });

    const setupAuthenticatedMocks = () => {
        const user = testUser();
        const proj = testProject();
        const col = testColumn();
        const task = testTask();

        fetchMock.mockImplementation((input: RequestInfo) => {
            const url = typeof input === "string" ? input : input.url;
            const u = new URL(url);
            const path = u.pathname;

            if (path.endsWith("/auth/login")) {
                return mockJsonResponse(user);
            }
            if (path.endsWith("/users") && !path.includes("/members")) {
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

    const loginAndOpenBoard = async () => {
        setupAuthenticatedMocks();
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

        return user;
    };

    it("opens Board Copilot chat from the board and shows a local assistant reply", async () => {
        const user = await loginAndOpenBoard();

        await user.click(
            screen.getByRole("button", { name: /ask board copilot/i })
        );

        const messageInput = await screen.findByLabelText(
            "Message Board Copilot"
        );
        await user.type(messageInput, "Give me a quick board summary");
        await user.click(
            await screen.findByRole("button", { name: /send message/i })
        );

        await waitFor(() => {
            expect(screen.getByText(/task on the board/i)).toBeInTheDocument();
        });
    });

    it("runs natural language task search and filters the task list", async () => {
        const user = await loginAndOpenBoard();

        const nlInput = screen.getByRole("textbox", {
            name: /Find related tasks/i
        });
        await user.type(nlInput, "first task");
        await user.click(
            screen.getByRole("button", { name: /Find related tasks/i })
        );

        await waitFor(() => {
            expect(screen.getByText("First task")).toBeInTheDocument();
        });
    });

    it("toggles Project AI off and hides the natural language search slot", async () => {
        const user = await loginAndOpenBoard();

        expect(
            screen.getByRole("textbox", { name: /Find related tasks/i })
        ).toBeInTheDocument();

        await user.click(
            screen.getByRole("button", { name: /board copilot settings/i })
        );
        await user.click(
            await screen.findByRole("switch", {
                name: /board copilot for this project/i
            })
        );

        await waitFor(() => {
            expect(
                screen.queryByRole("textbox", { name: /Find related tasks/i })
            ).not.toBeInTheDocument();
        });
    });

    it("opens the Board Copilot brief drawer from the board toolbar", async () => {
        const user = await loginAndOpenBoard();

        await user.click(
            screen.getByRole("button", { name: /open board copilot brief/i })
        );

        await waitFor(() => {
            expect(
                screen.getByText(/board copilot brief/i)
            ).toBeInTheDocument();
        });

        const briefClose = document.querySelector(
            ".ant-drawer-open .ant-drawer-close"
        ) as HTMLElement | null;
        expect(briefClose).toBeTruthy();
        await user.click(briefClose!);

        await waitFor(() => {
            expect(
                document.querySelector(".ant-drawer-open")
            ).not.toBeInTheDocument();
        });
    });

    it("opens and closes the Board Copilot chat drawer", async () => {
        const user = await loginAndOpenBoard();

        await user.click(
            screen.getByRole("button", { name: /ask board copilot/i })
        );

        await waitFor(() => {
            expect(
                screen.getByLabelText("Message Board Copilot")
            ).toBeInTheDocument();
        });

        const chatClose = document.querySelector(
            ".ant-drawer-open .ant-drawer-close"
        ) as HTMLElement | null;
        expect(chatClose).toBeTruthy();
        await user.click(chatClose!);

        await waitFor(() => {
            expect(
                document.querySelector(".ant-drawer-open")
            ).not.toBeInTheDocument();
        });
    });
});
