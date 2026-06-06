interface IMilestone {
    _id: string;
    projectId: string;
    name: string;
    description?: string;
    /**
     * Date-only ISO strings (`YYYY-MM-DD`) at the form boundary; the
     * server may also return `null` for an unset date, so the union
     * admits `null` alongside the absent (`undefined`) case.
     */
    startDate?: string | null;
    dueDate?: string | null;
    /**
     * Lifecycle state. Defaults to `"open"` server-side on create; a
     * closed milestone is the "shipped / done" terminal state.
     */
    state?: "open" | "closed";
    /**
     * Server-managed timestamp from `serialize_document`. Optional
     * because the milestone write endpoints (`POST` / `PUT` / `DELETE
     * /milestones`) return a string acknowledgement ("Milestone created"
     * / "Milestone updated" / "Milestone deleted") rather than a
     * milestone object, and optimistic creates do not carry one until
     * the refetch lands.
     */
    createdAt?: string;
}
