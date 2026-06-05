interface IColumn {
    _id: string;
    columnName: string;
    projectId: string;
    index: number;
    wipLimit?: number;
    // Persisted "done" semantics: the source of truth for done-ness,
    // replacing the locale-fragile column-name heuristic. Optional on read
    // so legacy column docs that predate the field still deserialize.
    category?: "todo" | "in_progress" | "done";
    // Derived read alias the board returns alongside ``category``
    // (``isDone === (category === "done")``). Computed server-side; never
    // sent on a write.
    isDone?: boolean;
}
