interface ILabel {
    _id: string;
    projectId: string;
    name: string;
    color: string;
    /**
     * Server-managed timestamp from `serialize_document`. Optional
     * because the label write endpoints (`POST` / `PUT` / `DELETE
     * /labels`) return a string acknowledgement ("Label created" /
     * "Label updated" / "Label deleted") rather than a label object,
     * and optimistic creates do not carry one until the refetch lands.
     */
    createdAt?: string;
}
