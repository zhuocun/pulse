const SUGGESTION_RUN_ID_KEYS = [
    "brief_run_id",
    "run_id",
    "suggestion_id",
    "id"
] as const;

export const extractSuggestionRunId = (payload: unknown): string | null => {
    if (!payload || typeof payload !== "object") return null;

    const record = payload as Record<string, unknown>;
    for (const key of SUGGESTION_RUN_ID_KEYS) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.length > 0) {
            return candidate;
        }
    }

    return null;
};
