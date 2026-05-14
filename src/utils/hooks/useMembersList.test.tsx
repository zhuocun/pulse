import { renderHook, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import useApi from "./useApi";
import useMembersList, {
    MEMBERS_LIST_ENDPOINT,
    MEMBERS_LIST_QUERY_KEY,
    MEMBERS_LIST_STALE_TIME_MS
} from "./useMembersList";

jest.mock("./useApi");

const mockedUseApi = useApi as jest.MockedFunction<typeof useApi>;

const createQueryClient = () =>
    new QueryClient({
        defaultOptions: {
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

describe("useMembersList", () => {
    let apiMock: jest.MockedFunction<ReturnType<typeof useApi>>;

    beforeEach(() => {
        apiMock = jest.fn() as jest.MockedFunction<ReturnType<typeof useApi>>;
        mockedUseApi.mockReturnValue(apiMock);
    });

    it("exposes the canonical endpoint, query key, and 5-minute stale time", () => {
        expect(MEMBERS_LIST_ENDPOINT).toBe("users/members");
        expect(MEMBERS_LIST_QUERY_KEY).toEqual(["users/members"]);
        expect(MEMBERS_LIST_STALE_TIME_MS).toBe(5 * 60 * 1000);
    });

    it("populates the ['users/members'] cache with the API response", async () => {
        const queryClient = createQueryClient();
        const members: IMember[] = [
            { _id: "m1", email: "a@b.c", username: "Alice" },
            { _id: "m2", email: "b@b.c", username: "Bob" }
        ];
        apiMock.mockResolvedValue(members);

        const { result } = renderHook(() => useMembersList(), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(apiMock).toHaveBeenCalledWith(MEMBERS_LIST_ENDPOINT, {
            data: {},
            method: "GET"
        });
        expect(queryClient.getQueryData(MEMBERS_LIST_QUERY_KEY)).toEqual(
            members
        );
    });

    it("returns the shared cache entry on a second mount without a second API call", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([
            { _id: "m1", email: "a@b.c", username: "Alice" }
        ]);

        const { unmount, result } = renderHook(() => useMembersList(), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        unmount();

        // Second consumer mounts before staleTime elapses → no refetch.
        const { result: second } = renderHook(() => useMembersList(), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(second.current.isSuccess).toBe(true));

        expect(apiMock).toHaveBeenCalledTimes(1);
    });
});
