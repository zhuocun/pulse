import { act, renderHook, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import useApi from "./useApi";
import useReactMutation from "./useReactMutation";
import useReactQuery from "./useReactQuery";

jest.mock("./useApi");

const mockedUseApi = useApi as jest.MockedFunction<typeof useApi>;

const createQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { gcTime: Infinity, retry: false }
        }
    });

const createWrapper = (queryClient: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        );
    };

let apiMock: jest.MockedFunction<ReturnType<typeof useApi>>;
let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
    apiMock = jest.fn() as jest.MockedFunction<ReturnType<typeof useApi>>;
    mockedUseApi.mockReturnValue(apiMock);
    consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
});

/**
 * Contract tests for every FE component / hook that fires a REST call
 * through `useReactQuery` or `useReactMutation`. The point isn't to
 * re-test the hooks themselves (covered elsewhere) — it's to lock down
 * the precise endpoint / method / payload shape that each call-site
 * produces, so we catch accidental wire-shape regressions even when no
 * UI behavior changes.
 *
 * Each `describe` corresponds to a real component call-site; we drive
 * the same hook configuration the component uses and then inspect what
 * the helper ultimately handed to `api()`.
 */

describe("project listing — pages/project.tsx", () => {
    it("queries projects with filter params and falls into the projects cache key", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([{ _id: "p1", projectName: "Roadmap" }]);

        const { result } = renderHook(
            () =>
                useReactQuery<IProject[]>("projects", {
                    page: 0,
                    projectName: "Roadmap",
                    managerId: ""
                }),
            { wrapper: createWrapper(queryClient) }
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(apiMock).toHaveBeenCalledWith("projects", {
            data: { page: 0, projectName: "Roadmap" },
            method: "GET"
        });
    });
});

describe("project detail — pages/projectDetail.tsx", () => {
    it("queries the single project shape by projectId", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ _id: "p1", projectName: "Roadmap" });

        const { result } = renderHook(
            () => useReactQuery<IProject>("projects", { projectId: "p1" }),
            { wrapper: createWrapper(queryClient) }
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(apiMock).toHaveBeenCalledWith("projects", {
            data: { projectId: "p1" },
            method: "GET"
        });
        expect(
            queryClient.getQueryData(["projects", { projectId: "p1" }])
        ).toEqual({
            _id: "p1",
            projectName: "Roadmap"
        });
    });
});

describe("board page — pages/board.tsx", () => {
    it("queries the project, columns, and tasks for a board", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([]);

        const { result: boards } = renderHook(
            () => useReactQuery<IColumn[]>("boards", { projectId: "p1" }),
            { wrapper: createWrapper(queryClient) }
        );
        const { result: tasks } = renderHook(
            () => useReactQuery<ITask[]>("tasks", { projectId: "p1" }),
            { wrapper: createWrapper(queryClient) }
        );

        await waitFor(() => expect(boards.current.isSuccess).toBe(true));
        await waitFor(() => expect(tasks.current.isSuccess).toBe(true));

        expect(apiMock).toHaveBeenCalledWith("boards", {
            data: { projectId: "p1" },
            method: "GET"
        });
        expect(apiMock).toHaveBeenCalledWith("tasks", {
            data: { projectId: "p1" },
            method: "GET"
        });
    });
});

describe("auth provider — utils/authProvider.tsx", () => {
    it("queries the viewer record on mount via useReactQuery('users')", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ _id: "u1", jwt: "j", likedProjects: [] });

        const { result } = renderHook(() => useReactQuery<IUser>("users"), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(apiMock).toHaveBeenCalledWith("users", {
            data: {},
            method: "GET"
        });
    });
});

describe("members list — useMembersList", () => {
    it("queries users/members and caches under that exact key", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([{ _id: "m1", username: "Alice" }]);

        const { result } = renderHook(
            () => useReactQuery<IMember[]>("users/members"),
            { wrapper: createWrapper(queryClient) }
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(apiMock).toHaveBeenCalledWith("users/members", {
            data: {},
            method: "GET"
        });
        expect(queryClient.getQueryData(["users/members"])).toEqual([
            { _id: "m1", username: "Alice" }
        ]);
    });
});

describe("project modal — components/projectModal/index.tsx", () => {
    it("POST projects on create and PUT projects on edit", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ _id: "p1" });

        const { result: create } = renderHook(
            () => useReactMutation<IProject>("projects", "POST"),
            { wrapper: createWrapper(queryClient) }
        );
        const { result: update } = renderHook(
            () => useReactMutation<IProject>("projects", "PUT"),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await create.current.mutateAsync({
                projectName: "Roadmap",
                organization: "Acme"
            });
        });
        await act(async () => {
            await update.current.mutateAsync({
                _id: "p1",
                projectName: "Renamed",
                organization: "Acme",
                managerId: "u2"
            });
        });

        expect(apiMock).toHaveBeenNthCalledWith(1, "projects", {
            data: { projectName: "Roadmap", organization: "Acme" },
            method: "POST"
        });
        expect(apiMock).toHaveBeenNthCalledWith(2, "projects", {
            data: {
                _id: "p1",
                projectName: "Renamed",
                organization: "Acme",
                managerId: "u2"
            },
            method: "PUT"
        });
    });
});

describe("project list — components/projectList/index.tsx", () => {
    it("PUT users/likes uses the 'users' cache key for setCache writes", async () => {
        const queryClient = createQueryClient();
        const fresh = {
            _id: "u1",
            email: "alice@example.com",
            jwt: "j1",
            likedProjects: ["p1"],
            username: "Alice"
        };
        apiMock.mockResolvedValue(fresh);

        const { result } = renderHook(
            () =>
                useReactMutation<IUser>(
                    "users/likes",
                    "PUT",
                    "users",
                    undefined,
                    undefined,
                    true
                ),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({ projectId: "p1" });
        });

        expect(apiMock).toHaveBeenCalledWith("users/likes", {
            data: { projectId: "p1" },
            method: "PUT"
        });
        // After the PUT settles the cache is overwritten with the
        // returned IUser; the heart icon reads from this key.
        expect(queryClient.getQueryData(["users"])).toEqual(fresh);
    });

    it("DELETE projects invalidates the bare 'projects' key", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue({ ok: true });

        const { result } = renderHook(
            () => useReactMutation("projects", "DELETE", ["projects"]),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({ projectId: "p1" });
        });

        expect(apiMock).toHaveBeenCalledWith("projects", {
            data: { projectId: "p1" },
            method: "DELETE"
        });
        await waitFor(() =>
            expect(invalidateSpy).toHaveBeenCalledWith({
                queryKey: ["projects"]
            })
        );
    });
});

describe("column creator — components/columnCreator/index.tsx", () => {
    it("POST boards with columnName + projectId for the active board", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ _id: "c1" });

        const { result } = renderHook(
            () =>
                useReactMutation("boards", "POST", [
                    "boards",
                    { projectId: "p1" }
                ]),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({
                columnName: "Todo",
                projectId: "p1"
            });
        });

        expect(apiMock).toHaveBeenCalledWith("boards", {
            data: { columnName: "Todo", projectId: "p1" },
            method: "POST"
        });
    });
});

describe("column delete — components/column/index.tsx", () => {
    it("DELETE boards by columnId", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ ok: true });

        const { result } = renderHook(
            () =>
                useReactMutation("boards", "DELETE", [
                    "boards",
                    { projectId: "p1" }
                ]),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({ columnId: "c1" });
        });

        expect(apiMock).toHaveBeenCalledWith("boards", {
            data: { columnId: "c1" },
            method: "DELETE"
        });
    });
});

describe("task creator — components/taskCreator/index.tsx", () => {
    it("POST tasks with the full board payload including defaults", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ _id: "t1" });

        const { result } = renderHook(
            () =>
                useReactMutation("tasks", "POST", [
                    "tasks",
                    { projectId: "p1" }
                ]),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({
                taskName: "Fix login",
                projectId: "p1",
                columnId: "c1",
                coordinatorId: "u1",
                type: "Task",
                epic: "New Feature",
                storyPoints: 1,
                note: "No note yet"
            });
        });

        expect(apiMock).toHaveBeenCalledWith("tasks", {
            data: {
                taskName: "Fix login",
                projectId: "p1",
                columnId: "c1",
                coordinatorId: "u1",
                type: "Task",
                epic: "New Feature",
                storyPoints: 1,
                note: "No note yet"
            },
            method: "POST"
        });
    });
});

describe("task modal — components/taskModal/index.tsx", () => {
    it("PUT tasks updates the field-level diff", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ _id: "t1" });

        const { result } = renderHook(
            () =>
                useReactMutation("tasks", "PUT", [
                    "tasks",
                    { projectId: "p1" }
                ]),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({
                _id: "t1",
                projectId: "p1",
                storyPoints: 5,
                taskName: "Renamed"
            });
        });

        expect(apiMock).toHaveBeenCalledWith("tasks", {
            data: {
                _id: "t1",
                projectId: "p1",
                storyPoints: 5,
                taskName: "Renamed"
            },
            method: "PUT"
        });
    });

    it("DELETE tasks via taskId", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ ok: true });

        const { result } = renderHook(
            () =>
                useReactMutation(
                    "tasks",
                    "DELETE",
                    ["tasks", { projectId: "p1" }],
                    undefined,
                    () => {}
                ),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({ taskId: "t1" });
        });

        expect(apiMock).toHaveBeenCalledWith("tasks", {
            data: { taskId: "t1" },
            method: "DELETE"
        });
    });
});

describe("drag-and-drop — useDragEnd reorder mutations", () => {
    it("PUT boards/orders for column reorders", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ ok: true });

        const { result } = renderHook(
            () =>
                useReactMutation("boards/orders", "PUT", [
                    "boards",
                    { projectId: "p1" }
                ]),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({
                fromId: "c1",
                referenceId: "c3",
                type: "after"
            });
        });

        expect(apiMock).toHaveBeenCalledWith("boards/orders", {
            data: { fromId: "c1", referenceId: "c3", type: "after" },
            method: "PUT"
        });
    });

    it("PUT tasks/orders for task reorders (same column, downward)", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ ok: true });

        const { result } = renderHook(
            () =>
                useReactMutation("tasks/orders", "PUT", [
                    "tasks",
                    { projectId: "p1" }
                ]),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({
                fromColumnId: "c1",
                fromId: "t1",
                referenceColumnId: "c1",
                referenceId: "t2",
                type: "after"
            });
        });

        expect(apiMock).toHaveBeenCalledWith("tasks/orders", {
            data: {
                fromColumnId: "c1",
                fromId: "t1",
                referenceColumnId: "c1",
                referenceId: "t2",
                type: "after"
            },
            method: "PUT"
        });
    });

    it("PUT tasks/orders for cross-column drops omits referenceId when target is empty", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ ok: true });

        const { result } = renderHook(
            () =>
                useReactMutation("tasks/orders", "PUT", [
                    "tasks",
                    { projectId: "p1" }
                ]),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({
                fromColumnId: "c1",
                fromId: "t1",
                referenceColumnId: "c3",
                type: "before"
            });
        });

        // `filterRequest` should not introduce a `referenceId: undefined` key.
        const call = apiMock.mock.calls[0][1] as {
            data: Record<string, unknown>;
        };
        expect(call.data).not.toHaveProperty("referenceId");
        expect(call.data).toEqual({
            fromColumnId: "c1",
            fromId: "t1",
            referenceColumnId: "c3",
            type: "before"
        });
    });
});

describe("login / register forms — components/loginForm + registerForm", () => {
    it("forms can wrap a useReactMutation with auth endpoints (login)", async () => {
        // The actual forms use `authApis.login` directly (which manages
        // token persistence), but the registerForm uses useReactMutation
        // against `auth/register`. The login mutation hook variant in
        // loginForm wraps the credentials submission — guard the
        // endpoint/method shape here.
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ _id: "u1", jwt: "j" });

        const { result } = renderHook(
            () => useReactMutation<IUser>("auth/login", "POST"),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({
                email: "alice@example.com",
                password: "secret"
            });
        });

        expect(apiMock).toHaveBeenCalledWith("auth/login", {
            data: { email: "alice@example.com", password: "secret" },
            method: "POST"
        });
    });

    it("forms can wrap a useReactMutation with auth endpoints (register)", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ ok: true });

        const { result } = renderHook(
            () => useReactMutation("auth/register", "POST"),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({
                email: "alice@example.com",
                password: "secret",
                username: "Alice"
            });
        });

        expect(apiMock).toHaveBeenCalledWith("auth/register", {
            data: {
                email: "alice@example.com",
                password: "secret",
                username: "Alice"
            },
            method: "POST"
        });
    });
});

describe("agent mutation tooling — POST agents/mutations/* via useReactMutation", () => {
    it("POST agents/mutations/record carries the proposal + undo diff", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ ok: true });

        const { result } = renderHook(
            () => useReactMutation("agents/mutations/record", "POST"),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({
                proposal_id: "prop-1",
                project_id: "p1",
                undo: {
                    task_updates: [
                        {
                            task_id: "t1",
                            field: "storyPoints",
                            from: 3,
                            to: 5
                        }
                    ]
                }
            });
        });

        expect(apiMock).toHaveBeenCalledWith("agents/mutations/record", {
            data: {
                proposal_id: "prop-1",
                project_id: "p1",
                undo: {
                    task_updates: [
                        {
                            task_id: "t1",
                            field: "storyPoints",
                            from: 3,
                            to: 5
                        }
                    ]
                }
            },
            method: "POST"
        });
    });

    it("POST agents/mutations/undo reverses a recorded proposal", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ ok: true });

        const { result } = renderHook(
            () => useReactMutation("agents/mutations/undo", "POST"),
            { wrapper: createWrapper(queryClient) }
        );

        await act(async () => {
            await result.current.mutateAsync({
                proposal_id: "prop-1",
                project_id: "p1"
            });
        });

        expect(apiMock).toHaveBeenCalledWith("agents/mutations/undo", {
            data: { proposal_id: "prop-1", project_id: "p1" },
            method: "POST"
        });
    });
});

describe("repeated component-level mutations", () => {
    it("survives a burst of 30 sequential project creates without leaking state", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ _id: "p" });

        const { result } = renderHook(
            () => useReactMutation<IProject>("projects", "POST", ["projects"]),
            { wrapper: createWrapper(queryClient) }
        );

        for (let i = 0; i < 30; i++) {
            await act(async () => {
                await result.current.mutateAsync({
                    projectName: `Project ${i}`,
                    organization: "Acme"
                });
            });
        }

        expect(apiMock).toHaveBeenCalledTimes(30);
        apiMock.mock.calls.forEach((call, i) => {
            const [endpoint, config] = call as [
                string,
                { data: Record<string, unknown>; method: string }
            ];
            expect(endpoint).toBe("projects");
            expect(config.method).toBe("POST");
            expect(config.data).toEqual({
                projectName: `Project ${i}`,
                organization: "Acme"
            });
        });
    });

    it("survives a burst of 20 parallel task updates with distinct payloads", async () => {
        const queryClient = createQueryClient();
        apiMock.mockImplementation(async (_endpoint, config) => ({
            _id: ((config as { data: { _id: string } }).data as { _id: string })
                ._id
        }));

        const { result } = renderHook(
            () =>
                useReactMutation("tasks", "PUT", [
                    "tasks",
                    { projectId: "p1" }
                ]),
            { wrapper: createWrapper(queryClient) }
        );

        const calls = Array.from({ length: 20 }, (_, i) =>
            result.current.mutateAsync({
                _id: `t${i}`,
                projectId: "p1",
                storyPoints: i + 1
            })
        );
        const settled = await Promise.allSettled(calls);

        expect(apiMock).toHaveBeenCalledTimes(20);
        settled.forEach((s, i) => {
            expect(s.status).toBe("fulfilled");
            expect((s as PromiseFulfilledResult<unknown>).value).toEqual({
                _id: `t${i}`
            });
        });
    });
});

describe("filterRequest invariants at the component layer", () => {
    it("strips undefined / null / NaN keys before sending POST tasks", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue({ _id: "t1" });

        const { result } = renderHook(() => useReactMutation("tasks", "POST"), {
            wrapper: createWrapper(queryClient)
        });

        await act(async () => {
            await result.current.mutateAsync({
                taskName: "Real",
                projectId: "p1",
                coordinatorId: undefined,
                columnId: null,
                storyPoints: Number.NaN
            });
        });

        // The mutation helper feeds through `filterRequest`, which drops
        // undefined / null / NaN. Each of those would otherwise stomp
        // server-side values on a partial update.
        const call = apiMock.mock.calls[0][1] as {
            data: Record<string, unknown>;
        };
        expect(call.data).toEqual({
            taskName: "Real",
            projectId: "p1"
        });
        expect(Object.keys(call.data)).not.toContain("coordinatorId");
        expect(Object.keys(call.data)).not.toContain("columnId");
        expect(Object.keys(call.data)).not.toContain("storyPoints");
    });

    it("strips empty-string filters from a projects GET query", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([]);

        const { result } = renderHook(
            () =>
                useReactQuery<IProject[]>("projects", {
                    projectName: "",
                    managerId: ""
                }),
            { wrapper: createWrapper(queryClient) }
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(apiMock).toHaveBeenCalledWith("projects", {
            data: {},
            method: "GET"
        });
    });
});
