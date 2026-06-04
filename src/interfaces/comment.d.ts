interface IComment {
    _id: string;
    taskId: string;
    projectId: string;
    authorId: string;
    body: string;
    mentions: string[];
    /**
     * Server-managed timestamp from `serialize_document`. Optional
     * because the comment write endpoints (`POST` / `PUT` / `DELETE
     * /comments`) return a string acknowledgement ("Comment created" /
     * "Comment updated" / "Comment deleted") rather than a comment
     * object, and optimistic creates do not carry one until the refetch
     * lands.
     */
    createdAt?: string;
}
