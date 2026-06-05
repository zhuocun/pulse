import { useCallback } from "react";

import useReactMutation from "./useReactMutation";
import {
    getProjectMembersQueryKey,
    PROJECT_MEMBERS_ENDPOINT
} from "./useProjectMembers";

/**
 * Project-member write hook (M4 — backend Collaboration feature).
 *
 * The companion to the read-only `useProjectMembers`: this hook owns the
 * roster's three owner-gated writes (add / change-role / remove) so the
 * Members surface doesn't reach for `useReactMutation` directly and
 * re-derive the endpoint string + query key. It mirrors the thin
 * REST-resource convention of `useLabels` / `useComments`: bare resource
 * path (reused from `useProjectMembers` so there's one source of truth),
 * the matching per-project query key, and a `useReactMutation` per verb.
 *
 * Backend contract (`backend/app/routers/projects.py`):
 *   - `POST   /api/v1/projects/members/` body `{ projectId, userId, role }`
 *     → 201 "Member added" (idempotent upsert; re-adding updates the role).
 *   - `PUT    /api/v1/projects/members/` body `{ projectId, userId, role }`
 *     → 200 "Member updated" ("Member not found" surfaces as 404).
 *   - `DELETE /api/v1/projects/members/?projectId=&userId=`
 *     → 200 "Member removed".
 *
 * All three are OWNER-gated server-side and refuse to touch the project's
 * `managerId` row (400 "Bad request" — the manager is immutable). Each
 * mutation invalidates the per-project roster key on success (the
 * `useReactMutation` default), so the list re-fetches and settles to the
 * server's post-write truth.
 */
interface UseProjectMemberMutations {
    /** Adds (or, server-side, upserts the role of) a member by user id. */
    addMember: (input: { userId: string; role: string }) => Promise<unknown>;
    /** True while the add mutation is in flight. */
    isAdding: boolean;
    /** Changes an existing member's role. */
    updateMemberRole: (input: {
        userId: string;
        role: string;
    }) => Promise<unknown>;
    /** True while the role-change mutation is in flight. */
    isUpdating: boolean;
    /** Removes a member from the project by user id. */
    removeMember: (input: { userId: string }) => Promise<unknown>;
    /** True while the remove mutation is in flight. */
    isRemoving: boolean;
}

const useProjectMemberMutations = (
    projectId: string | undefined
): UseProjectMemberMutations => {
    const queryKey = getProjectMembersQueryKey(projectId);

    const { mutateAsync: add, isLoading: isAdding } = useReactMutation<unknown>(
        PROJECT_MEMBERS_ENDPOINT,
        "POST",
        queryKey
    );
    const { mutateAsync: update, isLoading: isUpdating } =
        useReactMutation<unknown>(PROJECT_MEMBERS_ENDPOINT, "PUT", queryKey);
    const { mutateAsync: remove, isLoading: isRemoving } =
        useReactMutation<unknown>(PROJECT_MEMBERS_ENDPOINT, "DELETE", queryKey);

    const addMember = useCallback(
        (input: { userId: string; role: string }) =>
            add({ projectId, userId: input.userId, role: input.role }),
        [add, projectId]
    );

    const updateMemberRole = useCallback(
        (input: { userId: string; role: string }) =>
            update({ projectId, userId: input.userId, role: input.role }),
        [update, projectId]
    );

    const removeMember = useCallback(
        (input: { userId: string }) =>
            remove({ projectId, userId: input.userId }),
        [remove, projectId]
    );

    return {
        addMember,
        isAdding,
        updateMemberRole,
        isUpdating,
        removeMember,
        isRemoving
    };
};

export default useProjectMemberMutations;
