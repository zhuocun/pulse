import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import {
    resetApiRateLimitForTests,
    resetInFlightApiCallsForTests
} from "../../utils/hooks/useApi";
import useBulkSelection, {
    BulkSelectionProvider
} from "../../utils/hooks/useBulkSelection";

import BulkEditToolbar from ".";

const PROJECT_ID = "p1";
const TASK_KEY = ["tasks", { projectId: PROJECT_ID }];

const task = (overrides: Partial<ITask> = {}): ITask =>
    ({
        _id: "t1",
        columnId: "c1",
        coordinatorId: "m1",
        epic: "Feature",
        index: 0,
        note: "",
        priority: "none",
        projectId: PROJECT_ID,
        storyPoints: 1,
        taskName: "Build",
        type: "Task",
        ...overrides
    }) as ITask;

const members: IMember[] = [
    { _id: "m1", email: "a@b.c", username: "Alice" } as IMember,
    { _id: "m2", email: "b@b.c", username: "Bob" } as IMember
];

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

/** Test harness: a button to drive selection from inside the provider. */
const SelectTwo = () => {
    const { toggle } = useBulkSelection();
    return (
        <button
            onClick={() => {
                toggle("t1");
                toggle("t2");
            }}
            type="button"
        >
            select-two
        </button>
    );
};

const makeClient = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(TASK_KEY, [
        task({ _id: "t1", priority: "none" }),
        task({ _id: "t2", priority: "low" })
    ]);
    return queryClient;
};

const renderToolbar = (queryClient: QueryClient) =>
    render(
        <QueryClientProvider client={queryClient}>
            <AntdApp>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <BulkSelectionProvider>
                                    <SelectTwo />
                                    <BulkEditToolbar members={members} />
                                </BulkSelectionProvider>
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </AntdApp>
        </QueryClientProvider>
    );

const pickPriorityHigh = async () => {
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Set priority" }));
    fireEvent.click(await screen.findByText("High"));
};

describe("BulkEditToolbar", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeEach(() => {
        fetchMock.mockReset();
        resetApiRateLimitForTests();
        resetInFlightApiCallsForTests();
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    it("stays hidden until at least one task is selected", () => {
        renderToolbar(makeClient());
        expect(
            screen.queryByTestId("bulk-edit-toolbar")
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByText("select-two"));
        expect(screen.getByTestId("bulk-edit-toolbar")).toBeInTheDocument();
        expect(screen.getByText("2 tasks selected")).toBeInTheDocument();
    });

    it("disables Apply until a field is chosen", () => {
        renderToolbar(makeClient());
        fireEvent.click(screen.getByText("select-two"));

        expect(
            screen.getByRole("button", {
                name: "Apply changes to the selected tasks"
            })
        ).toBeDisabled();
    });

    it("optimistically applies the change and clears selection on success", async () => {
        const queryClient = makeClient();
        // Defer the PUT so we can observe the optimistic cache mid-flight.
        let resolveFetch: (value: Response) => void = () => undefined;
        fetchMock.mockReturnValue(
            new Promise<Response>((resolve) => {
                resolveFetch = resolve;
            })
        );

        renderToolbar(queryClient);
        fireEvent.click(screen.getByText("select-two"));
        await pickPriorityHigh();

        fireEvent.click(
            screen.getByRole("button", {
                name: "Apply changes to the selected tasks"
            })
        );

        // Optimistic patch: both selected tasks flip to "high" before the
        // server responds.
        await waitFor(() => {
            const cached = queryClient.getQueryData<ITask[]>(TASK_KEY);
            expect(cached?.every((t) => t.priority === "high")).toBe(true);
        });

        // The request carried the bulk payload (taskIds + changes; no
        // routing fields).
        const body = JSON.parse(
            (fetchMock.mock.calls[0][1] as RequestInit).body as string
        );
        expect(body).toEqual({
            taskIds: ["t1", "t2"],
            changes: { priority: "high" }
        });
        expect(String(fetchMock.mock.calls[0][0])).toContain("tasks/bulk");

        resolveFetch(response("Tasks updated"));

        // Selection clears (toolbar unmounts) once the mutation settles.
        await waitFor(() =>
            expect(
                screen.queryByTestId("bulk-edit-toolbar")
            ).not.toBeInTheDocument()
        );
    });

    it("rolls the optimistic change back and keeps the selection on error", async () => {
        const queryClient = makeClient();
        fetchMock.mockResolvedValue(response("Forbidden", false));

        renderToolbar(queryClient);
        fireEvent.click(screen.getByText("select-two"));
        await pickPriorityHigh();

        fireEvent.click(
            screen.getByRole("button", {
                name: "Apply changes to the selected tasks"
            })
        );

        // After the failure, the cache reverts to the seeded priorities…
        await waitFor(() => {
            const cached = queryClient.getQueryData<ITask[]>(TASK_KEY);
            expect(cached?.[0].priority).toBe("none");
            expect(cached?.[1].priority).toBe("low");
        });
        // …and the selection survives so the user can retry.
        expect(screen.getByTestId("bulk-edit-toolbar")).toBeInTheDocument();
    });
});
