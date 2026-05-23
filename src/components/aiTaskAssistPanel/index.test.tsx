import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useEffect } from "react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ANALYTICS_EVENTS, setAnalyticsSink } from "../../constants/analytics";
import { store } from "../../store";
import AiTaskAssistPanel from ".";

const installAntdMocks = () => {
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
};

const seedClient = () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
        ["users/members"],
        [{ _id: "m1", email: "a@b.c", username: "Alice" }]
    );
    queryClient.setQueryData(
        ["boards", { projectId: "p1" }],
        [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }]
    );
    queryClient.setQueryData(
        ["tasks", { projectId: "p1" }],
        [
            {
                _id: "t1",
                columnId: "c1",
                coordinatorId: "m1",
                epic: "Auth",
                index: 0,
                note: "old",
                projectId: "p1",
                storyPoints: 5,
                taskName: "Old login bug",
                type: "Bug"
            },
            {
                _id: "t2",
                columnId: "c1",
                coordinatorId: "m1",
                epic: "Auth",
                index: 1,
                note: "old",
                projectId: "p1",
                storyPoints: 3,
                taskName: "Reset password",
                type: "Task"
            }
        ]
    );
    return queryClient;
};

const mountPanel = (
    overrides: Partial<{
        values: {
            taskName?: string;
            note?: string;
            type?: string;
            epic?: string;
            coordinatorId?: string;
            storyPoints?: number;
        };
        onApplyStoryPoints: (value: StoryPoints) => void;
        onApplySuggestion: (
            field: IReadinessIssue["field"],
            suggestion: string | undefined,
            options?: { replace?: boolean }
        ) => void;
        onOpenSimilarTask: (taskId: string) => void;
        excludeTaskId?: string;
    }> = {}
) => {
    const queryClient = seedClient();
    const onApplyStoryPoints = jest.fn();
    const onApplySuggestion = jest.fn();
    const onOpenSimilarTask = jest.fn();
    render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <AiTaskAssistPanel
                                    excludeTaskId={overrides.excludeTaskId}
                                    onApplyStoryPoints={
                                        overrides.onApplyStoryPoints ??
                                        onApplyStoryPoints
                                    }
                                    onApplySuggestion={
                                        overrides.onApplySuggestion ??
                                        onApplySuggestion
                                    }
                                    onOpenSimilarTask={
                                        overrides.onOpenSimilarTask ??
                                        onOpenSimilarTask
                                    }
                                    values={
                                        overrides.values ?? {
                                            taskName:
                                                "Investigate flaky login bug"
                                        }
                                    }
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
    return { onApplyStoryPoints, onApplySuggestion, onOpenSimilarTask };
};

const Harness = ({
    queryClient,
    children
}: {
    queryClient: QueryClient;
    children: ReactNode;
}) => (
    <Provider store={store}>
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={["/projects/p1/board"]}>
                <Routes>
                    <Route
                        path="/projects/:projectId/board"
                        element={children}
                    />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    </Provider>
);

const advanceBy = (ms: number) => {
    act(() => {
        jest.advanceTimersByTime(ms);
    });
};

describe("AiTaskAssistPanel", () => {
    beforeAll(() => {
        installAntdMocks();
    });

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it("shows story-point suggestion grounded in the cache and applies it", async () => {
        const { onApplyStoryPoints } = mountPanel();
        // debounce flush
        await waitFor(() =>
            expect(jest.getTimerCount()).toBeGreaterThanOrEqual(1)
        );
        advanceBy(1000);
        const apply = await screen.findByLabelText(
            "Apply suggested story points"
        );
        fireEvent.click(apply);
        expect(onApplyStoryPoints).toHaveBeenCalledTimes(1);
    });

    it("applies a readiness suggestion to the bound field", async () => {
        const { onApplySuggestion } = mountPanel({
            values: { taskName: "Hi" }
        });
        advanceBy(1000);
        const button = await screen.findByLabelText(
            /Apply readiness suggestion for taskName/
        );
        fireEvent.click(button);
        expect(onApplySuggestion).toHaveBeenCalledWith(
            "taskName",
            expect.any(String)
        );
    });

    it("opens a similar task when its button is clicked", async () => {
        const { onOpenSimilarTask } = mountPanel({
            values: { taskName: "Investigate flaky login bug" }
        });
        advanceBy(1000);
        const button = await screen.findByRole("button", {
            name: /Old login bug/i
        });
        fireEvent.click(button);
        expect(onOpenSimilarTask).toHaveBeenCalledWith("t1");
    });

    it("renders a positive readiness alert when nothing is wrong", async () => {
        mountPanel({
            values: {
                taskName: "Reset password reliably",
                note: "## Acceptance criteria\n- Done when reset works",
                epic: "Auth",
                type: "Task",
                coordinatorId: "m1"
            }
        });
        advanceBy(1000);
        expect(
            await screen.findByText(/Looks ready to work on/)
        ).toBeInTheDocument();
    });

    // The visible-warning path (`useAi.error` set) is covered by
    // `effectErrors.test.tsx`, which mocks `useAi` so it can return a non-null
    // `error`. The previous in-suite test relied on a fetch mock, but the
    // local engine bypasses fetch, so `error` was never set and the test could
    // not pass. Removed in favour of the dedicated mock-based test.

    it("fires COPILOT_REWRITE_ACCEPT when a readiness Apply button is clicked", async () => {
        const tracked: Array<[string, Record<string, unknown> | undefined]> =
            [];
        const previous = setAnalyticsSink((event, payload) => {
            tracked.push([event, payload]);
        });
        try {
            mountPanel({ values: { taskName: "Hi" } });
            advanceBy(1000);
            const button = await screen.findByLabelText(
                /Apply readiness suggestion for taskName/
            );
            fireEvent.click(button);
        } finally {
            setAnalyticsSink(previous);
        }

        const rewriteCalls = tracked.filter(
            ([e]) => e === ANALYTICS_EVENTS.COPILOT_REWRITE_ACCEPT
        );
        expect(rewriteCalls).toHaveLength(1);
        expect(rewriteCalls[0][1]).toMatchObject({
            field: "taskName",
            projectId: "p1"
        });
        expect(rewriteCalls[0][1]).not.toHaveProperty("taskId");
    });

    it("COPILOT_REWRITE_ACCEPT passes excludeTaskId as taskId separately from projectId", async () => {
        const tracked: Array<[string, Record<string, unknown> | undefined]> =
            [];
        const previous = setAnalyticsSink((event, payload) => {
            tracked.push([event, payload]);
        });
        try {
            mountPanel({
                values: { taskName: "Hi" },
                excludeTaskId: "task-exclude-1"
            });
            advanceBy(1000);
            const button = await screen.findByLabelText(
                /Apply readiness suggestion for taskName/
            );
            fireEvent.click(button);
        } finally {
            setAnalyticsSink(previous);
        }

        const rewriteCalls = tracked.filter(
            ([e]) => e === ANALYTICS_EVENTS.COPILOT_REWRITE_ACCEPT
        );
        expect(rewriteCalls).toHaveLength(1);
        expect(rewriteCalls[0][1]).toMatchObject({
            field: "taskName",
            projectId: "p1",
            taskId: "task-exclude-1"
        });
    });

    it("re-runs suggestions when board context arrives after the panel mounts", async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                mutations: { retry: false },
                queries: { retry: false }
            }
        });
        queryClient.setQueryData(
            ["users/members"],
            [{ _id: "m1", email: "a@b.c", username: "Alice" }]
        );

        const ContextSeeder = () => {
            useEffect(() => {
                setTimeout(() => {
                    queryClient.setQueryData(
                        ["boards", { projectId: "p1" }],
                        [
                            {
                                _id: "c1",
                                columnName: "Todo",
                                index: 0,
                                projectId: "p1"
                            }
                        ]
                    );
                    queryClient.setQueryData(
                        ["tasks", { projectId: "p1" }],
                        [
                            {
                                _id: "t1",
                                columnId: "c1",
                                coordinatorId: "m1",
                                epic: "Auth",
                                index: 0,
                                note: "old",
                                projectId: "p1",
                                storyPoints: 5,
                                taskName: "Old login bug",
                                type: "Bug"
                            }
                        ]
                    );
                }, 50);
            }, []);

            return (
                <AiTaskAssistPanel
                    onApplyStoryPoints={jest.fn()}
                    onApplySuggestion={jest.fn()}
                    onOpenSimilarTask={jest.fn()}
                    values={{ taskName: "Investigate flaky login bug" }}
                />
            );
        };

        render(
            <Harness queryClient={queryClient}>
                <ContextSeeder />
            </Harness>
        );

        advanceBy(1000);

        await waitFor(() =>
            expect(screen.getByText(/Similar tasks:/)).toBeInTheDocument()
        );
        expect(screen.getByText("Old login bug")).toBeInTheDocument();
    });
});
