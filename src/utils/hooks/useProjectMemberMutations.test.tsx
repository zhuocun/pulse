import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { ReactNode } from "react";

import useApi from "./useApi";
import useProjectMemberMutations from "./useProjectMemberMutations";
import {
    getProjectMembersQueryKey,
    PROJECT_MEMBERS_ENDPOINT
} from "./useProjectMembers";

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

describe("useProjectMemberMutations", () => {
    let apiMock: jest.MockedFunction<ReturnType<typeof useApi>>;

    beforeEach(() => {
        apiMock = jest.fn() as jest.MockedFunction<ReturnType<typeof useApi>>;
        mockedUseApi.mockReturnValue(apiMock);
    });

    it("reuses the canonical project-members endpoint and per-project key", () => {
        expect(PROJECT_MEMBERS_ENDPOINT).toBe("projects/members");
        expect(getProjectMembersQueryKey("project-1")).toEqual([
            "projects/members",
            { projectId: "project-1" }
        ]);
    });

    it("addMember POSTs { projectId, userId, role } and invalidates the roster", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue("Member added");

        const { result } = renderHook(
            () => useProjectMemberMutations("project-1"),
            { wrapper: createWrapper(queryClient) }
        );

        await result.current.addMember({ userId: "user-2", role: "editor" });

        expect(apiMock).toHaveBeenCalledWith(PROJECT_MEMBERS_ENDPOINT, {
            data: { projectId: "project-1", userId: "user-2", role: "editor" },
            method: "POST"
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: getProjectMembersQueryKey("project-1")
        });
    });

    it("updateMemberRole PUTs { projectId, userId, role } and invalidates the roster", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue("Member updated");

        const { result } = renderHook(
            () => useProjectMemberMutations("project-1"),
            { wrapper: createWrapper(queryClient) }
        );

        await result.current.updateMemberRole({
            userId: "user-2",
            role: "owner"
        });

        expect(apiMock).toHaveBeenCalledWith(PROJECT_MEMBERS_ENDPOINT, {
            data: { projectId: "project-1", userId: "user-2", role: "owner" },
            method: "PUT"
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: getProjectMembersQueryKey("project-1")
        });
    });

    it("removeMember DELETEs with { projectId, userId } and invalidates the roster", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue("Member removed");

        const { result } = renderHook(
            () => useProjectMemberMutations("project-1"),
            { wrapper: createWrapper(queryClient) }
        );

        await result.current.removeMember({ userId: "user-2" });

        expect(apiMock).toHaveBeenCalledWith(PROJECT_MEMBERS_ENDPOINT, {
            data: { projectId: "project-1", userId: "user-2" },
            method: "DELETE"
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: getProjectMembersQueryKey("project-1")
        });
    });

    it("exposes per-mutation loading flags", () => {
        const queryClient = createQueryClient();
        const { result } = renderHook(
            () => useProjectMemberMutations("project-1"),
            { wrapper: createWrapper(queryClient) }
        );

        expect(result.current.isAdding).toBe(false);
        expect(result.current.isUpdating).toBe(false);
        expect(result.current.isRemoving).toBe(false);
    });
});
