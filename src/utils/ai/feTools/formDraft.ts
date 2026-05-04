import type { FeTool } from "./types";

interface FormDraftResult {
    formId: string;
    fields: Record<string, unknown>;
}

/**
 * `fe.formDraft` — read the in-progress form draft for a given form id.
 * Phase A has no central form-draft context yet; this returns `{draft: null}`
 * so the agent can fall back to its own state. A future integration with
 * the create-task / edit-task modals will surface real values here.
 */
export const formDraftTool: FeTool<
    { formId: string } | void,
    { draft: FormDraftResult | null }
> = {
    name: "fe.formDraft",
    description:
        "Return the user's in-progress form draft (null until the form context lands).",
    run: () => {
        return { draft: null };
    }
};
