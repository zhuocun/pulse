import { renderHook, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import useApi from "./useApi";
import useComments, {
    COMMENTS_ENDPOINT,
    COMMENTS_STALE_TIME_MS,
    getCommentsQueryKey
} from "./useComments";
import { NOTIFICATIONS_QUERY_KEY } from "./useNotifications";

jest.mock("./useApi");

const mockedUseApi = useApi as jest.MockedFunction<typeof useApi>;

const createQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: {
                gcTime: Infinity,
                retry: false
            }
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

const comment = (overrides: Partial<IComment> = {}): IComment => ({
    _id: "comment-1",
    taskId: "task-1",
    projectId: "project-1",
    authorId: "user-1",
    body: "First comment",
    mentions: [],
    createdAt: "2026-06-01T10:00:00.000Z",
    ...overrides
});

describe("useComments", () => {
    let apiMock: jest.MockedFunction<ReturnType<typeof useApi>>;

    beforeEach(() => {
        apiMock = jest.fn() as jest.MockedFunction<ReturnType<typeof useApi>>;
        mockedUseApi.mockReturnValue(apiMock);
    });

    it("exposes the canonical endpoint, per-task query key, and stale time", () => {
        expect(COMMENTS_ENDPOINT).toBe("comments");
        expect(getCommentsQueryKey("task-1")).toEqual([
            "comments",
            { taskId: "task-1" }
        ]);
        expect(COMMENTS_STALE_TIME_MS).toBe(30 * 1000);
    });

    it("GETs comments for the task and exposes the list", async () => {
        const queryClient = createQueryClient();
        const comments = [
            comment({ _id: "c1" }),
            comment({ _id: "c2", body: "Second" })
        ];
        apiMock.mockResolvedValue(comments);

        const { result } = renderHook(() => useComments("task-1"), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.comments).toEqual(comments));
        expect(apiMock).toHaveBeenCalledWith(COMMENTS_ENDPOINT, {
            data: { taskId: "task-1" },
            method: "GET"
        });
        expect(queryClient.getQueryData(getCommentsQueryKey("task-1"))).toEqual(
            comments
        );
    });

    it("does not fetch until a taskId is known (query disabled)", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([comment()]);

        const { result } = renderHook(() => useComments(undefined), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(apiMock).not.toHaveBeenCalled();
        expect(result.current.comments).toBeUndefined();
    });

    it("does not fetch for an optimistic placeholder task id", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([comment()]);

        const { result } = renderHook(() => useComments("tmp-abc"), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(apiMock).not.toHaveBeenCalled();
        expect(result.current.comments).toBeUndefined();
    });

    it("normalizes a non-array payload to undefined so consumers never crash", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue("Comment created" as unknown as IComment[]);

        const { result } = renderHook(() => useComments("task-1"), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.comments).toBeUndefined();
    });

    it("surfaces a load error via isError", async () => {
        const queryClient = createQueryClient();
        apiMock.mockRejectedValue(new Error("boom"));

        const { result } = renderHook(() => useComments("task-1"), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.comments).toBeUndefined();
    });

    it("createComment POSTs { taskId, body } (no mentions) and invalidates the thread", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue([comment()]);

        const { result } = renderHook(() => useComments("task-1"), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.comments).toBeDefined());

        apiMock.mockClear();
        invalidateSpy.mockClear();
        apiMock.mockResolvedValue("Comment created");
        await result.current.createComment({ body: "Hello" });

        expect(apiMock).toHaveBeenCalledWith(COMMENTS_ENDPOINT, {
            data: { taskId: "task-1", body: "Hello" },
            method: "POST"
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: getCommentsQueryKey("task-1")
        });
        // No mention sent → the notifications query is NOT invalidated.
        expect(invalidateSpy).not.toHaveBeenCalledWith({
            queryKey: NOTIFICATIONS_QUERY_KEY
        });
    });

    it("createComment with mentions sends the array and invalidates notifications too", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue([comment()]);

        const { result } = renderHook(() => useComments("task-1"), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.comments).toBeDefined());

        apiMock.mockClear();
        invalidateSpy.mockClear();
        apiMock.mockResolvedValue("Comment created");
        await result.current.createComment({
            body: "Hey @bob",
            mentions: ["user-2", "user-3"]
        });

        expect(apiMock).toHaveBeenCalledWith(COMMENTS_ENDPOINT, {
            data: {
                taskId: "task-1",
                body: "Hey @bob",
                mentions: ["user-2", "user-3"]
            },
            method: "POST"
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: getCommentsQueryKey("task-1")
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: NOTIFICATIONS_QUERY_KEY
        });
    });

    it("editComment PUTs { _id, body } and invalidates the thread", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue([comment()]);

        const { result } = renderHook(() => useComments("task-1"), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.comments).toBeDefined());

        apiMock.mockClear();
        invalidateSpy.mockClear();
        apiMock.mockResolvedValue("Comment updated");
        await result.current.editComment({ _id: "c1", body: "Edited" });

        expect(apiMock).toHaveBeenCalledWith(COMMENTS_ENDPOINT, {
            data: { _id: "c1", body: "Edited" },
            method: "PUT"
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: getCommentsQueryKey("task-1")
        });
    });

    it("deleteComment DELETEs with { commentId } and invalidates the thread", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue([comment()]);

        const { result } = renderHook(() => useComments("task-1"), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.comments).toBeDefined());

        apiMock.mockClear();
        invalidateSpy.mockClear();
        apiMock.mockResolvedValue("Comment deleted");
        await result.current.deleteComment("c1");

        expect(apiMock).toHaveBeenCalledWith(COMMENTS_ENDPOINT, {
            data: { commentId: "c1" },
            method: "DELETE"
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: getCommentsQueryKey("task-1")
        });
    });
});
