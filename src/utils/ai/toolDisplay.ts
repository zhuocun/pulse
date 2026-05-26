import { microcopy, microcopyString } from "../../constants/microcopy";

const checkedProjects = microcopyString(microcopy.ai.toolVerbs.checkedProjects);
const checkedTeamMembers = microcopyString(
    microcopy.ai.toolVerbs.checkedTeamMembers
);
const checkedBoardColumns = microcopyString(
    microcopy.ai.toolVerbs.checkedBoardColumns
);
const checkedTasks = microcopyString(microcopy.ai.toolVerbs.checkedTasks);
const openedProject = microcopyString(microcopy.ai.toolVerbs.openedProject);
const openedTask = microcopyString(microcopy.ai.toolVerbs.openedTask);

export const TOOL_VERB: Record<string, string> = {
    listProjects: checkedProjects,
    "fe.listProjects": checkedProjects,
    listMembers: checkedTeamMembers,
    "fe.listMembers": checkedTeamMembers,
    listBoard: checkedBoardColumns,
    "fe.listBoard": checkedBoardColumns,
    listTasks: checkedTasks,
    "fe.listTasks": checkedTasks,
    getProject: openedProject,
    "fe.getProject": openedProject,
    getTask: openedTask,
    "fe.getTask": openedTask
};

export const humanizeTool = (name?: string) => {
    if (!name) return microcopyString(microcopy.ai.toolVerbs.lookedUpEvidence);
    if (TOOL_VERB[name]) return TOOL_VERB[name];
    return name
        .replace(/^.*:/, "")
        .replace(/^fe\./, "")
        .replace(/([A-Z])/g, " $1")
        .replace(/[._]/g, " ")
        .replace(/^./, (s) => s.toUpperCase());
};

export const summarizeToolBody = (body: string): string => {
    const trimmed = body.trim();
    if (!trimmed) return microcopyString(microcopy.ai.toolEmptyResult);
    const firstLine = trimmed.split("\n", 1)[0];
    return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
};

export const CITATION_INLINE_LIMIT = 6;

export const BUDGET_WARN_THRESHOLD = 6000;
export const BUDGET_CRITICAL_THRESHOLD = 7500;
