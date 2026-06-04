import { renderHook, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import useApi from "./useApi";
import useProjectMembers, {
    getProjectMembersQueryKey,
    PROJECT_MEMBERS_ENDPOINT,
    PROJECT_MEMBERS_STALE_TIME_MS
} from "./useProjectMembers";

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

const projectMember = (
    overrides: Partial<IProjectMember> = {}
): IProjectMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    role: "coordinator",
    ...overrides
});

describe("useProjectMembers", () => {
    let apiMock: jest.MockedFunction<ReturnType<typeof useApi>>;

    beforeEach(() => {
        apiMock = jest.fn() as jest.MockedFunction<ReturnType<typeof useApi>>;
        mockedUseApi.mockReturnValue(apiMock);
    });

    it("exposes the project-roster endpoint (NOT the global users directory), key, and stale time", () => {
        // Critical distinction: this hook reads the PROJECT roster, a
        // different endpoint + shape from `useMembersList` (`users/members`).
        expect(PROJECT_MEMBERS_ENDPOINT).toBe("projects/members");
        expect(getProjectMembersQueryKey("project-1")).toEqual([
            "projects/members",
            { projectId: "project-1" }
        ]);
        expect(PROJECT_MEMBERS_STALE_TIME_MS).toBe(5 * 60 * 1000);
    });

    it("GETs project members for the project and populates the cache", async () => {
        const queryClient = createQueryClient();
        const members = [
            projectMember(),
            projectMember({
                _id: "member-2",
                email: "bob@example.com",
                username: "Bob",
                role: "manager"
            })
        ];
        apiMock.mockResolvedValue(members);

        const { result } = renderHook(() => useProjectMembers("project-1"), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(apiMock).toHaveBeenCalledWith(PROJECT_MEMBERS_ENDPOINT, {
            data: { projectId: "project-1" },
            method: "GET"
        });
        expect(
            queryClient.getQueryData(getProjectMembersQueryKey("project-1"))
        ).toEqual(members);
    });

    it("does not fetch until a projectId is known (query disabled)", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([projectMember()]);

        const { result } = renderHook(() => useProjectMembers(undefined), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(apiMock).not.toHaveBeenCalled();
    });
});
