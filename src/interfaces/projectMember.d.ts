/**
 * A member of a single project, as returned by
 * `GET /api/v1/projects/members/?projectId=`.
 *
 * Distinct from `IMember` (the global user-directory shape behind
 * `GET /api/v1/users/members`, used by the coordinator picker): a project
 * member additionally carries the user's `role` within that project. The
 * shared identity fields (`_id`, `username`, `email`) are inherited from
 * `IMember` so a project member is assignable wherever an `IMember` is
 * expected (e.g. the avatar / option renderers).
 */
interface IProjectMember extends IMember {
    /** The member's role within the project (e.g. "manager", "coordinator"). */
    role: string;
}
