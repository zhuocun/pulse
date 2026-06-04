import { renderHook, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import useApi from "./useApi";
import useLabels, {
    getLabelsQueryKey,
    LABELS_ENDPOINT,
    LABELS_STALE_TIME_MS
} from "./useLabels";

jest.mock("./useApi");

const mockedUseApi = useApi as jest.MockedFunction<typeof useApi>;

const createQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: {
                gcTime: Infinity,
                retry: false
            },
            mutations: { retry: false }
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

const label = (overrides: Partial<ILabel> = {}): ILabel => ({
    _id: "label-1",
    projectId: "project-1",
    name: "Backend",
    color: "blue",
    ...overrides
});

describe("useLabels", () => {
    let apiMock: jest.MockedFunction<ReturnType<typeof useApi>>;

    beforeEach(() => {
        apiMock = jest.fn() as jest.MockedFunction<ReturnType<typeof useApi>>;
        mockedUseApi.mockReturnValue(apiMock);
    });

    it("exposes the canonical endpoint, per-project query key, and 5-minute stale time", () => {
        expect(LABELS_ENDPOINT).toBe("labels");
        expect(getLabelsQueryKey("project-1")).toEqual([
            "labels",
            { projectId: "project-1" }
        ]);
        expect(LABELS_STALE_TIME_MS).toBe(5 * 60 * 1000);
    });

    it("GETs labels for the project and exposes the list", async () => {
        const queryClient = createQueryClient();
        const labels = [label(), label({ _id: "label-2", name: "Frontend" })];
        apiMock.mockResolvedValue(labels);

        const { result } = renderHook(() => useLabels("project-1"), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.labels).toEqual(labels));
        expect(apiMock).toHaveBeenCalledWith(LABELS_ENDPOINT, {
            data: { projectId: "project-1" },
            method: "GET"
        });
        expect(
            queryClient.getQueryData(getLabelsQueryKey("project-1"))
        ).toEqual(labels);
    });

    it("does not fetch until a projectId is known (query disabled)", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([label()]);

        const { result } = renderHook(() => useLabels(undefined), {
            wrapper: createWrapper(queryClient)
        });

        // Give React Query a tick to (not) fire.
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(apiMock).not.toHaveBeenCalled();
        expect(result.current.labels).toBeUndefined();
    });

    it("normalizes a non-array payload to undefined so consumers never crash", async () => {
        const queryClient = createQueryClient();
        // A stray ack string / errored body sharing the cache must not
        // reach the `.map` consumers as a non-iterable.
        apiMock.mockResolvedValue("Label created" as unknown as ILabel[]);

        const { result } = renderHook(() => useLabels("project-1"), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.labels).toBeUndefined();
    });

    it("createLabel POSTs { projectId, name, color } and invalidates the list", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue([label()]);

        const { result } = renderHook(() => useLabels("project-1"), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.labels).toBeDefined());

        apiMock.mockClear();
        apiMock.mockResolvedValue("Label created");
        await result.current.createLabel({ name: "Infra", color: "gold" });

        expect(apiMock).toHaveBeenCalledWith(LABELS_ENDPOINT, {
            data: { projectId: "project-1", name: "Infra", color: "gold" },
            method: "POST"
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: getLabelsQueryKey("project-1")
        });
    });
});
