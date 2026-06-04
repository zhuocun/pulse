interface INotification {
    _id: string;
    userId: string;
    kind: string;
    refId: string;
    /**
     * Originating project, when the notification was produced by a
     * project-scoped event (e.g. an @mention in a task comment). Optional
     * because future, non-project notification kinds may omit it.
     */
    projectId?: string;
    summary: string;
    isRead: boolean;
    /**
     * Server-managed timestamp from `serialize_document`. Optional
     * because the mark-read endpoint (`PUT /notifications`) returns a
     * string acknowledgement ("Notification updated") rather than a
     * notification object.
     */
    createdAt?: string;
}
