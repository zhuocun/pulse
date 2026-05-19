import { applyApprovedMutationTool } from "./applyApprovedMutation";
import { applyMutationTool } from "./applyMutation";
import { boardSnapshotTool } from "./boardSnapshot";
import { formDraftTool } from "./formDraft";
import { getProjectTool } from "./getProject";
import { getTaskTool } from "./getTask";
import { listBoardTool } from "./listBoard";
import { listMembersTool } from "./listMembers";
import { listProjectsTool } from "./listProjects";
import { listTasksTool } from "./listTasks";
import { recentActivityTool } from "./recentActivity";
import { requestMutationApprovalTool } from "./requestMutationApproval";
import { searchCandidatesTool } from "./searchCandidates";
import { similarTasksTool } from "./similarTasks";
import { viewerContextTool } from "./viewerContext";
import type { FeTool } from "./types";

const tools: Array<FeTool<never, unknown>> = [
    applyMutationTool,
    applyApprovedMutationTool,
    requestMutationApprovalTool,
    listProjectsTool,
    listMembersTool,
    getProjectTool,
    listBoardTool,
    listTasksTool,
    getTaskTool,
    boardSnapshotTool,
    similarTasksTool,
    viewerContextTool,
    recentActivityTool,
    formDraftTool,
    searchCandidatesTool
] as Array<FeTool<never, unknown>>;

/**
 * Single source of truth for FE tools that the agent may invoke via an
 * `interrupt` event (PRD §5.5). Keys are the qualified `fe.*` names; the
 * `useAgent` hook auto-resumes the run when the interrupt's tool is in
 * this map, so adding a tool here is enough to make it agent-callable.
 *
 * Note: `fe.applyMutation` is preserved as a deprecation shim that
 * dispatches to the two new tools below — `fe.requestMutationApproval`
 * for the HITL stage and `fe.applyApprovedMutation` for the execution
 * stage. New agent prompts should target the split tools directly.
 */
export const FE_TOOL_REGISTRY: Record<
    string,
    FeTool<unknown, unknown>
> = Object.fromEntries(tools.map((t) => [t.name, t])) as Record<
    string,
    FeTool<unknown, unknown>
>;

export type { FeTool, FeToolContext } from "./types";
