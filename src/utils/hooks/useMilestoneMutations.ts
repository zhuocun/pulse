import { useCallback } from "react";

import useReactMutation from "./useReactMutation";
import { getMilestonesQueryKey, MILESTONES_ENDPOINT } from "./useMilestones";

/**
 * Project-milestone write hook (FE-MS-1 — backend Milestones feature).
 *
 * The companion to the read-only `useMilestones`: this hook owns the
 * milestone list's three editor-gated writes (create / update / delete)
 * so the Milestones surface doesn't reach for `useReactMutation` directly
 * and re-derive the endpoint string + query key. It mirrors the thin
 * REST-resource convention of `useLabels` / `useProjectMemberMutations`:
 * the bare resource path (reused from `useMilestones` so there's one
 * source of truth), the matching per-project query key, and a
 * `useReactMutation` per verb — all three keyed on the same list so each
 * write invalidates exactly that project's milestone list.
 *
 * Backend contract (`backend/app/routers/milestones.py`):
 *   - `POST   /api/v1/milestones/` body `{ projectId, name, description?,
 *     startDate?, dueDate?, state? }` → 201 "Milestone created"
 *     (`name` required; `state ∈ {"open","closed"}`, default `"open"`).
 *   - `PUT    /api/v1/milestones/` body `{ _id, name?, description?,
 *     startDate?, dueDate?, state? }` → 200 "Milestone updated".
 *   - `DELETE /api/v1/milestones/?milestoneId=` → 200 "Milestone deleted"
 *     (the DELETE serializes its body to the query string — see `useApi`).
 *
 * All three are EDITOR-gated server-side (a non-editor write 403s). The
 * Milestones surface mirrors the members manager's FE role-gate — it
 * derives the caller's project role from the same `useProjectMembers`
 * roster + project `managerId` and hides the write controls from a
 * viewer/guest — so this hook is only invoked by an editor-or-above. A
 * residual 403 (a stale role, a cold deep-link race) still rejects the
 * promise, which the caller surfaces as an error toast via its own
 * `catch`. Each mutation invalidates the per-project list key on success
 * (the `useReactMutation` default), so the list re-fetches and settles to
 * the server's post-write truth.
 */
interface CreateMilestoneInput {
    name: string;
    description?: string;
    startDate?: string | null;
    dueDate?: string | null;
    state?: "open" | "closed";
}

interface UpdateMilestoneInput {
    _id: string;
    name?: string;
    description?: string;
    startDate?: string | null;
    dueDate?: string | null;
    state?: "open" | "closed";
}

interface UseMilestoneMutations {
    /** Creates a milestone on the active project (POST `{ projectId, ... }`). */
    createMilestone: (input: CreateMilestoneInput) => Promise<unknown>;
    /** True while the create mutation is in flight. */
    isCreating: boolean;
    /** Updates an existing milestone (PUT `{ _id, ... }`). */
    updateMilestone: (input: UpdateMilestoneInput) => Promise<unknown>;
    /** True while the update mutation is in flight. */
    isUpdating: boolean;
    /** Removes a milestone by id (DELETE serialized to `?milestoneId=`). */
    removeMilestone: (milestoneId: string) => Promise<unknown>;
    /** True while the delete mutation is in flight. */
    isRemoving: boolean;
}

const useMilestoneMutations = (
    projectId: string | undefined
): UseMilestoneMutations => {
    const queryKey = getMilestonesQueryKey(projectId);

    const { mutateAsync: create, isLoading: isCreating } =
        useReactMutation<unknown>(MILESTONES_ENDPOINT, "POST", queryKey);
    const { mutateAsync: update, isLoading: isUpdating } =
        useReactMutation<unknown>(MILESTONES_ENDPOINT, "PUT", queryKey);
    const { mutateAsync: remove, isLoading: isRemoving } =
        useReactMutation<unknown>(MILESTONES_ENDPOINT, "DELETE", queryKey);

    const createMilestone = useCallback(
        (input: CreateMilestoneInput) => create({ projectId, ...input }),
        [create, projectId]
    );

    const updateMilestone = useCallback(
        (input: UpdateMilestoneInput) => update({ ...input }),
        [update]
    );

    const removeMilestone = useCallback(
        (milestoneId: string) => remove({ milestoneId }),
        [remove]
    );

    return {
        createMilestone,
        isCreating,
        updateMilestone,
        isUpdating,
        removeMilestone,
        isRemoving
    };
};

export default useMilestoneMutations;
