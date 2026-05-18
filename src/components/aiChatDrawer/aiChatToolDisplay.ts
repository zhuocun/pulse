import { microcopy, microcopyString } from "../../constants/microcopy";

/**
 * Plain-language verb for each known tool (Optimization Plan §3 P2-2).
 *
 * Tool messages in the chat transcript should read like evidence the
 * assistant gathered ("Checked 12 tasks"), not like a function call
 * ("listTasks · 12 items"). Unmapped tools fall back to a sentence-cased
 * version of the raw name so a future tool that hasn't been wired here
 * still produces sensible UI.
 */
export const TOOL_VERB: Record<string, string> = {
    listProjects: microcopyString(microcopy.ai.toolVerbs.checkedProjects),
    listMembers: microcopyString(microcopy.ai.toolVerbs.checkedTeamMembers),
    listBoard: microcopyString(microcopy.ai.toolVerbs.checkedBoardColumns),
    listTasks: microcopyString(microcopy.ai.toolVerbs.checkedTasks),
    getProject: microcopyString(microcopy.ai.toolVerbs.openedProject),
    getTask: microcopyString(microcopy.ai.toolVerbs.openedTask)
};

export const humanizeTool = (name?: string) => {
    if (!name) return microcopyString(microcopy.ai.toolVerbs.lookedUpEvidence);
    if (TOOL_VERB[name]) return TOOL_VERB[name];
    return name
        .replace(/^.*:/, "")
        .replace(/[._]/g, " ")
        .replace(/^./, (s) => s.toUpperCase());
};

/**
 * Tool message bodies are now plain-language evidence summaries (see
 * `summarizeToolResultForUser`) instead of raw JSON. The collapsed
 * `<details>` summary line just shows the first sentence so users can
 * scan the evidence chain without expanding every row.
 */
export const summarizeToolBody = (body: string): string => {
    const trimmed = body.trim();
    if (!trimmed) return microcopyString(microcopy.ai.toolEmptyResult);
    const firstLine = trimmed.split("\n", 1)[0];
    return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
};

/**
 * Citations are inline superscript chips after the assistant bubble. When
 * an answer leans on a lot of records (e.g. a workload summary that cites
 * every member) rendering all of them inline produces a sprawling chip
 * tail that crowds the message. We collapse anything over this threshold
 * behind a "+N more" affordance — clicking it expands the list inline
 * (no second click required) so verifying every claim is still possible.
 */
export const CITATION_INLINE_LIMIT = 6;

/** Approximate token thresholds for context-window warnings (P1-C). */
export const BUDGET_WARN_THRESHOLD = 6000;
export const BUDGET_CRITICAL_THRESHOLD = 7500;
