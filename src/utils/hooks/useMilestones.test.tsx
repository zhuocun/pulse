import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { ReactNode } from "react";

import useApi from "./useApi";
import useMilestones, {
    getMilestonesQueryKey,
    MILESTONES_ENDPOINT,
    MILESTONES_STALE_TIME_MS
} from "./useMilestones";

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

const milestone = (overrides: Partial<IMilestone> = {}): IMilestone => ({
    _id: "milestone-1",
    projectId: "project-1",
    name: "v1 launch",
    state: "open",
    ...overrides
});

describe("useMilestones", () => {
    let apiMock: jest.MockedFunction<ReturnType<typeof useApi>>;

    beforeEach(() => {
        apiMock = jest.fn() as jest.MockedFunction<ReturnType<typeof useApi>>;
        mockedUseApi.mockReturnValue(apiMock);
    });

    it("exposes the canonical endpoint, per-project query key, and 5-minute stale time", () => {
        expect(MILESTONES_ENDPOINT).toBe("milestones");
        expect(getMilestonesQueryKey("project-1")).toEqual([
            "milestones",
            { projectId: "project-1" }
        ]);
        expect(MILESTONES_STALE_TIME_MS).toBe(5 * 60 * 1000);
    });

    it("GETs milestones for the project and exposes the list", async () => {
        const queryClient = createQueryClient();
        const milestones = [
            milestone(),
            milestone({ _id: "milestone-2", name: "v2", state: "closed" })
        ];
        apiMock.mockResolvedValue(milestones);

        const { result } = renderHook(() => useMilestones("project-1"), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.data).toEqual(milestones));
        expect(apiMock).toHaveBeenCalledWith(MILESTONES_ENDPOINT, {
            data: { projectId: "project-1" },
            method: "GET"
        });
        expect(
            queryClient.getQueryData(getMilestonesQueryKey("project-1"))
        ).toEqual(milestones);
    });

    it("does not fetch until a projectId is known (query disabled)", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([milestone()]);

        const { result } = renderHook(() => useMilestones(undefined), {
            wrapper: createWrapper(queryClient)
        });

        // Give React Query a tick to (not) fire.
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(apiMock).not.toHaveBeenCalled();
        expect(result.current.data).toBeUndefined();
    });

    it("normalizes a non-array payload to undefined so consumers never crash", async () => {
        const queryClient = createQueryClient();
        // A stray ack string / errored body sharing the cache must not
        // reach the `.map` consumer as a non-iterable.
        apiMock.mockResolvedValue(
            "Milestone created" as unknown as IMilestone[]
        );

        const { result } = renderHook(() => useMilestones("project-1"), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.data).toBeUndefined();
    });
});
