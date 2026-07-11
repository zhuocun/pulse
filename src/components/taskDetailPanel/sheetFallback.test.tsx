import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";

import { store } from "../../store";

import TaskDetailPanel from ".";

/*
 * W2-01 contract test — deep-link hydration guard. On the very first
 * render (before effects run) the panel must force Sheet's static
 * shadcn `<Sheet>` fallback via `forceDrawerFallback`, so a deep-linked
 * mount never kicks off the animated multi-detent enter transition
 * mid-hydration. After mount, the animated branch takes over.
 *
 * The Sheet module is mocked to record the prop across renders; the
 * animated-vs-fallback branch selection itself is covered by
 * `src/components/sheet/index.test.tsx`.
 */

const mockFallbackHistory: boolean[] = [];

jest.mock("../sheet", () => {
    const React = require("react");
    return {
        __esModule: true,
        default: (props: {
            forceDrawerFallback?: boolean;
            children?: React.ReactNode;
        }) => {
            mockFallbackHistory.push(props.forceDrawerFallback === true);
            return React.createElement(
                "section",
                { "data-testid": "sheet-mock" },
                props.children
            );
        }
    };
});

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

const task: ITask = {
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

const members: IMember[] = [
    { _id: "member-1", email: "alice@example.com", username: "Alice" }
];

const renderDeepLinkedPanel = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users/members"], members);
    queryClient.setQueryData(["tasks", { projectId: "project-1" }], [task]);
    const router = createMemoryRouter(
        [
            {
                path: "/projects/:projectId/board",
                element: <Outlet />,
                children: [
                    {
                        path: "task/:taskId",
                        element: (
                            <TaskDetailPanel
                                boardAiOn={false}
                                projectId="project-1"
                                taskId="task-1"
                            />
                        )
                    }
                ]
            }
        ],
        { initialEntries: ["/projects/project-1/board/task/task-1"] }
    );
    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <RouterProvider router={router} />
            </QueryClientProvider>
        </Provider>
    );
};

describe("TaskDetailPanel — deep-link Sheet fallback (W2-01)", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        mockFallbackHistory.length = 0;
    });

    it("forces the Drawer fallback on first render, then releases it after mount", async () => {
        renderDeepLinkedPanel();

        expect(await screen.findByTestId("sheet-mock")).toBeInTheDocument();
        expect(mockFallbackHistory.length).toBeGreaterThan(0);
        // First render — before the mount effect flips `hasMounted` —
        // pins the static Drawer branch.
        expect(mockFallbackHistory[0]).toBe(true);
        // Once effects run, the animated branch is allowed again.
        await waitFor(() => {
            expect(mockFallbackHistory[mockFallbackHistory.length - 1]).toBe(
                false
            );
        });
    });
});
