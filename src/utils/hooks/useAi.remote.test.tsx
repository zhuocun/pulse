import { act, renderHook, waitFor } from "@testing-library/react";

jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        aiBaseUrl: "https://copilot.example",
        aiEnabled: true,
        aiUseLocalEngine: false,
        apiBaseUrl: "/api/v1"
    }
}));

// eslint-disable-next-line simple-import-sort/imports
import useAi from "./useAi";

const localContext = (): {
    columns: IColumn[];
    members: IMember[];
    tasks: ITask[];
    project: { _id: string; projectName: string };
} => ({
    columns: [{ _id: "col-1", columnName: "Todo", index: 0, projectId: "p1" }],
    members: [{ _id: "m1", email: "a@b.c", username: "Alice" }],
    project: { _id: "p1", projectName: "Roadmap" },
    tasks: [
        {
            _id: "t1",
            columnId: "col-1",
            coordinatorId: "m1",
            epic: "Auth",
            index: 0,
            note: "",
            projectId: "p1",
            storyPoints: 3,
            taskName: "Fix login",
            type: "Bug"
        }
    ]
});

describe("useAi remote transport", () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
        fetchSpy = jest.spyOn(global, "fetch");
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it("posts the payload to the configured base URL and validates the response", async () => {
        fetchSpy.mockResolvedValue({
            json: jest.fn().mockResolvedValue({
                columnId: "ghost",
                confidence: 0.9,
                coordinatorId: "ghost",
                epic: "Auth",
                note: "n",
                rationale: "r",
                storyPoints: 3,
                taskName: "Remote draft",
                type: "Task"
            }),
            ok: true,
            status: 200
        } as unknown as Response);

        const { result } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );

        await act(async () => {
            await result.current.run({
                draft: { prompt: "Hello", context: localContext() }
            });
        });

        expect(fetchSpy).toHaveBeenCalledWith(
            "https://copilot.example/api/ai/task-draft",
            expect.objectContaining({ method: "POST" })
        );
        expect(result.current.data?.taskName).toBe("Remote draft");
        expect(result.current.data?.columnId).toBe("col-1");
        expect(result.current.data?.coordinatorId).toBe("m1");
    });

    it("surfaces remote HTTP errors", async () => {
        fetchSpy.mockResolvedValue({
            json: jest.fn().mockResolvedValue({}),
            ok: false,
            status: 500
        } as unknown as Response);

        const { result } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );

        let caught: Error | null = null;
        await act(async () => {
            try {
                await result.current.run({
                    draft: { prompt: "Hello", context: localContext() }
                });
            } catch (err) {
                caught = err as Error;
            }
        });
        expect(caught).toBeInstanceOf(Error);
        // Fix 4: 5xx responses now throw AgentServerError instead of generic Error.
        expect((caught as unknown as Error).name).toBe("AgentServerError");
        await waitFor(() => {
            expect(result.current.error).not.toBeNull();
        });
    });

    it("aborts an in-flight remote request on unmount", async () => {
        fetchSpy.mockImplementation(
            ((_url: string, init?: { signal?: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () =>
                        reject(new DOMException("aborted", "AbortError"))
                    );
                })) as unknown as typeof fetch
        );

        const { result, unmount } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );
        let promise: Promise<unknown> | undefined;
        act(() => {
            promise = result.current
                .run({ draft: { prompt: "x", context: localContext() } })
                .catch((err) => err);
        });
        unmount();
        const settled = await promise;
        expect((settled as Error).name).toBe("AbortError");
    });

    it("aborts a previous request when run is called again", async () => {
        let pending: Array<{
            resolve: (value: Response) => void;
            signal?: AbortSignal;
        }> = [];
        fetchSpy.mockImplementation(
            ((_url: string, init?: { signal?: AbortSignal }) =>
                new Promise<Response>((resolve, reject) => {
                    pending.push({ resolve, signal: init?.signal });
                    init?.signal?.addEventListener("abort", () =>
                        reject(new DOMException("aborted", "AbortError"))
                    );
                })) as unknown as typeof fetch
        );

        const { result } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );
        const first = result.current
            .run({ draft: { prompt: "first", context: localContext() } })
            .catch((err) => err);
        const second = result.current
            .run({ draft: { prompt: "second", context: localContext() } })
            .catch((err) => err);
        pending[1].resolve({
            json: jest.fn().mockResolvedValue({
                columnId: "col-1",
                confidence: 0.5,
                coordinatorId: "m1",
                epic: "x",
                note: "n",
                rationale: "r",
                storyPoints: 3,
                taskName: "second",
                type: "Task"
            }),
            ok: true,
            status: 200
        } as unknown as Response);
        await act(async () => {
            await first;
            await second;
        });
        const aborted = (await first) as Error;
        expect(aborted.name).toBe("AbortError");
        expect(result.current.data?.taskName).toBe("second");
        pending = [];
    });

    it("posts search payload to the remote proxy and filters unknown ids", async () => {
        fetchSpy.mockResolvedValue({
            json: jest.fn().mockResolvedValue({
                ids: ["t1", "ghost"],
                rationale: "from server"
            }),
            ok: true,
            status: 200
        } as unknown as Response);

        const { result } = renderHook(() =>
            useAi<ISearchResult>({ route: "search" })
        );

        await act(async () => {
            await result.current.run({
                search: {
                    kind: "tasks",
                    query: "login",
                    projectContext: localContext()
                }
            });
        });

        expect(fetchSpy).toHaveBeenCalledWith(
            "https://copilot.example/api/ai/search",
            expect.objectContaining({ method: "POST" })
        );
        expect(result.current.data?.ids).toEqual(["t1"]);
        expect(result.current.data?.rationale).toBe("from server");
    });

    // Fix 2 — Idempotency-Key header
    it("sends an Idempotency-Key header on every AI request", async () => {
        fetchSpy.mockResolvedValue({
            json: jest.fn().mockResolvedValue({
                columnId: "col-1",
                confidence: 0.8,
                coordinatorId: "m1",
                epic: "Auth",
                note: "n",
                rationale: "r",
                storyPoints: 3,
                taskName: "Idempotency test",
                type: "Task"
            }),
            ok: true,
            status: 200
        } as unknown as Response);

        const { result } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );

        await act(async () => {
            await result.current.run({
                draft: { prompt: "key test", context: localContext() }
            });
        });

        const headers = (
            fetchSpy.mock.calls[0][1] as { headers?: Record<string, string> }
        ).headers;
        expect(headers).toBeDefined();
        expect(headers!["Idempotency-Key"]).toBeTruthy();
        // Should be a UUID-like string (contains hyphens).
        expect(headers!["Idempotency-Key"]).toMatch(/-/);
    });

    // Fix 4 — typed errors from v1 non-OK responses
    it("throws AgentAuthError for 401 responses", async () => {
        fetchSpy.mockResolvedValue({
            ok: false,
            status: 401,
            text: jest.fn().mockResolvedValue(""),
            headers: { get: () => null }
        } as unknown as Response);

        const { result } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );
        let caught: Error | null = null;
        await act(async () => {
            try {
                await result.current.run({
                    draft: { prompt: "x", context: localContext() }
                });
            } catch (err) {
                caught = err as Error;
            }
        });
        expect(caught).not.toBeNull();
        expect(caught!.name).toBe("AgentAuthError");
    });

    it("throws AgentBudgetError for 402 responses", async () => {
        fetchSpy.mockResolvedValue({
            ok: false,
            status: 402,
            text: jest.fn().mockResolvedValue(""),
            headers: { get: () => null }
        } as unknown as Response);

        const { result } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );
        let caught: Error | null = null;
        await act(async () => {
            try {
                await result.current.run({
                    draft: { prompt: "x", context: localContext() }
                });
            } catch (err) {
                caught = err as Error;
            }
        });
        expect(caught!.name).toBe("AgentBudgetError");
    });

    it("throws AgentForbiddenError for 403 responses", async () => {
        fetchSpy.mockResolvedValue({
            ok: false,
            status: 403,
            text: jest.fn().mockResolvedValue(""),
            headers: { get: () => null }
        } as unknown as Response);

        const { result } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );
        let caught: Error | null = null;
        await act(async () => {
            try {
                await result.current.run({
                    draft: { prompt: "x", context: localContext() }
                });
            } catch (err) {
                caught = err as Error;
            }
        });
        expect(caught!.name).toBe("AgentForbiddenError");
    });

    it("throws AgentNotFoundError for 404 responses", async () => {
        fetchSpy.mockResolvedValue({
            ok: false,
            status: 404,
            text: jest.fn().mockResolvedValue(""),
            headers: { get: () => null }
        } as unknown as Response);

        const { result } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );
        let caught: Error | null = null;
        await act(async () => {
            try {
                await result.current.run({
                    draft: { prompt: "x", context: localContext() }
                });
            } catch (err) {
                caught = err as Error;
            }
        });
        expect(caught!.name).toBe("AgentNotFoundError");
    });

    it("throws AgentRateLimitError for 429 responses", async () => {
        fetchSpy.mockResolvedValue({
            ok: false,
            status: 429,
            text: jest.fn().mockResolvedValue(""),
            headers: { get: (h: string) => (h === "Retry-After" ? "30" : null) }
        } as unknown as Response);

        const { result } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );
        let caught: Error | null = null;
        await act(async () => {
            try {
                await result.current.run({
                    draft: { prompt: "x", context: localContext() }
                });
            } catch (err) {
                caught = err as Error;
            }
        });
        expect(caught!.name).toBe("AgentRateLimitError");
    });

    it("throws AgentServerError for 5xx responses", async () => {
        fetchSpy.mockResolvedValue({
            ok: false,
            status: 503,
            text: jest.fn().mockResolvedValue(""),
            headers: { get: () => null }
        } as unknown as Response);

        const { result } = renderHook(() =>
            useAi<IDraftTaskSuggestion>({ route: "task-draft" })
        );
        let caught: Error | null = null;
        await act(async () => {
            try {
                await result.current.run({
                    draft: { prompt: "x", context: localContext() }
                });
            } catch (err) {
                caught = err as Error;
            }
        });
        expect(caught!.name).toBe("AgentServerError");
    });
});
