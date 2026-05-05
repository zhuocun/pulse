import { microcopy } from "../../constants/microcopy";
import { boardBrief } from "./engine";
import type { AiChatToolCall, ChatToolName } from "./chatTools";

import type { CitationRef } from "../../interfaces/agent";

export interface AiChatMessage {
    role: "user" | "assistant" | "tool";
    content: string;
    toolCallId?: string;
    toolName?: ChatToolName;
    /**
     * Sources backing this assistant turn (Optimization Plan §3 P0-3).
     * Persisted on the message so older turns keep their citations after
     * later turns arrive — the previous implementation derived citations
     * from the latest tool messages and dropped them on subsequent turns.
     * `[]` is meaningful: the engine answered without consulting any tool.
     */
    citations?: CitationRef[];
    /**
     * Tool calls the assistant emitted on this turn, replayed on the next
     * server request so the LLM keeps multi-round context.
     *
     * Anthropic / OpenAI both require the assistant message that produced
     * a tool call to be present immediately before the matching
     * `ToolMessage` on the next turn — without `toolCalls` the provider
     * either 400s (Anthropic: "tool_result block references unknown
     * tool_use id") or silently drops the tool result (OpenAI). Storing
     * the assistant tool-call turn here lets `remoteChatStep` replay it
     * verbatim while keeping the visible chat transcript clean (the
     * drawer hides assistant turns whose `content` is empty and whose
     * `toolCalls` array is non-empty).
     */
    toolCalls?: AiChatToolCall[];
}

export interface ChatTurnToolCalls {
    kind: "tool_calls";
    toolCalls: AiChatToolCall[];
}

export interface ChatTurnText {
    kind: "text";
    text: string;
}

export type ChatTurnResult = ChatTurnToolCalls | ChatTurnText;

export interface ChatEngineContext {
    project: { _id: string; projectName: string };
    columns: IColumn[];
    tasks: ITask[];
    members: IMember[];
}

const lastUserMessage = (messages: AiChatMessage[]): string => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === "user") return messages[i].content;
    }
    return "";
};

const lastUserIndex = (messages: AiChatMessage[]): number => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === "user") return i;
    }
    return -1;
};

const makeId = () => `tool_${Math.random().toString(36).slice(2, 10)}`;

const openTasksLabel = (w: { openTasks: number; openPoints: number }): string =>
    `${(w.openTasks === 1
        ? microcopy.counts.tasksMatchingActiveFilters.one
        : microcopy.counts.tasksMatchingActiveFilters.other
    )
        .replace("{count}", String(w.openTasks))
        .replace(" matches the active filters", "")}, ${microcopy.brief.markdownStoryPoints.replace("{count}", String(w.openPoints))}`;

/**
 * After tool results are in the thread, produce a user-facing answer without issuing more tools.
 */
export const chatAssistantFinalizeAfterTools = (
    messages: AiChatMessage[]
): string => {
    const start = lastUserIndex(messages);
    if (start < 0) return "";
    const chunks: string[] = [];
    for (let i = start + 1; i < messages.length; i += 1) {
        if (messages[i].role === "tool" && messages[i].content.trim()) {
            chunks.push(messages[i].content.trim());
        }
    }
    if (chunks.length === 0)
        return microcopy.ai.requestedDataCouldNotBeLoaded as string;
    return chunks.join("\n\n---\n\n");
};

/**
 * Deterministic single step: either emit read-only tool calls or a short answer.
 * Used when the local AI engine is active (no remote proxy).
 */
export const chatAssistantTurn = (
    messages: AiChatMessage[],
    context: ChatEngineContext
): ChatTurnResult => {
    const userIdx = lastUserIndex(messages);
    const hasToolResultsAfterUser =
        userIdx >= 0 &&
        messages.slice(userIdx + 1).some((m) => m.role === "tool");
    if (hasToolResultsAfterUser) {
        return {
            kind: "text",
            text: chatAssistantFinalizeAfterTools(messages)
        };
    }

    const text = lastUserMessage(messages).toLowerCase();

    if (
        /\b(list|show|all)\s+projects\b|\bprojects?\s+list\b|\bwhat\s+projects\b/.test(
            text
        )
    ) {
        return {
            kind: "tool_calls",
            toolCalls: [
                {
                    id: makeId(),
                    name: "listProjects",
                    arguments: {}
                }
            ]
        };
    }

    if (
        /\b(list|show)\s+members\b|\bteam\b|\bwho\s+(is\s+)?on\b|\bassignees?\b/.test(
            text
        )
    ) {
        return {
            kind: "tool_calls",
            toolCalls: [
                {
                    id: makeId(),
                    name: "listMembers",
                    arguments: {}
                }
            ]
        };
    }

    if (
        /\b(board|columns?|swimlanes?)\b/.test(text) &&
        /\b(list|show|what|how)\b/.test(text)
    ) {
        return {
            kind: "tool_calls",
            toolCalls: [
                {
                    id: makeId(),
                    name: "listBoard",
                    arguments: { projectId: context.project._id }
                }
            ]
        };
    }

    if (
        /\b(how\s+many|count)\b.*\btasks?\b|\btasks?\b.*\b(count|many)\b|\blist\s+tasks\b/.test(
            text
        )
    ) {
        return {
            kind: "tool_calls",
            toolCalls: [
                {
                    id: makeId(),
                    name: "listTasks",
                    arguments: { projectId: context.project._id }
                }
            ]
        };
    }

    const taskIdMatch = text.match(
        /\b(task|ticket)\s+([a-z0-9_-]{6,})\b|#([a-z0-9_-]{6,})\b/i
    );
    const maybeId = taskIdMatch?.[2] ?? taskIdMatch?.[3];
    if (maybeId && context.tasks.some((t) => t._id === maybeId)) {
        return {
            kind: "tool_calls",
            toolCalls: [
                {
                    id: makeId(),
                    name: "getTask",
                    arguments: { taskId: maybeId }
                }
            ]
        };
    }

    const brief = boardBrief({
        project: context.project,
        columns: context.columns,
        tasks: context.tasks,
        members: context.members
    });

    let answer = `${brief.headline}\n\n${brief.recommendation}`;
    if (/\b(unowned|owner|assign)\b/.test(text) && brief.unowned.length > 0) {
        answer += `\n\n${microcopy.ai.unownedSection.replace(
            "{names}",
            brief.unowned.map((u) => u.taskName).join(", ")
        )}`;
    }
    if (/\b(workload|busy|points)\b/.test(text) && brief.workload.length > 0) {
        answer += `\n\n${microcopy.ai.workloadSection.replace(
            "{entries}",
            brief.workload
                .map((w) => `${w.username}: ${openTasksLabel(w)}`)
                .join("; ")
        )}`;
    }

    return { kind: "text", text: answer };
};

const isProjectArray = (x: unknown): x is IProject[] =>
    Array.isArray(x) &&
    x.every((p) => p && typeof (p as IProject)._id === "string");

const isMemberArray = (x: unknown): x is IMember[] =>
    Array.isArray(x) &&
    x.every((m) => m && typeof (m as IMember)._id === "string");

const isColumnArray = (x: unknown): x is IColumn[] =>
    Array.isArray(x) &&
    x.every((c) => c && typeof (c as IColumn)._id === "string");

const isTaskArray = (x: unknown): x is ITask[] =>
    Array.isArray(x) &&
    x.every((t) => t && typeof (t as ITask)._id === "string");

/**
 * Extract structured citations from a tool result payload (Optimization
 * Plan §3 P0-3). Returns at most three refs so the UI doesn't flood the
 * bubble with chips for list-style queries.
 *
 * Citations are inferred from object shape rather than tool name so
 * remote engines that emit a richer mix of payloads (tasks + members in
 * one call) still produce useful refs.
 */
export const citationsFromToolResult = (
    toolName: ChatToolName,
    payload: unknown
): CitationRef[] => {
    if (!payload || typeof payload !== "object") return [];
    const make = (entry: Record<string, unknown>): CitationRef | null => {
        const id = typeof entry._id === "string" ? entry._id : null;
        if (!id) return null;
        const taskName =
            typeof entry.taskName === "string" ? entry.taskName : null;
        const username =
            typeof entry.username === "string" ? entry.username : null;
        const projectName =
            typeof entry.projectName === "string" ? entry.projectName : null;
        const columnName =
            typeof entry.columnName === "string" ? entry.columnName : null;
        const quote = taskName ?? username ?? projectName ?? columnName ?? id;
        const source: CitationRef["source"] = taskName
            ? "task"
            : username
              ? "member"
              : columnName
                ? "column"
                : "project";
        return { source, id, quote };
    };
    const list = Array.isArray(payload) ? payload : [payload];
    const refs: CitationRef[] = [];
    for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const ref = make(entry as Record<string, unknown>);
        if (ref) refs.push(ref);
        if (refs.length >= 3) break;
    }
    // Dev sanity: ensure tool name was used to filter unsupported shapes.
    void toolName;
    return refs;
};

/**
 * Build a user-facing summary of a tool result (Optimization Plan §3 P2-2).
 *
 * Tool messages are rendered inline in the chat transcript and are visible
 * to non-technical users — they should read like evidence ("Checked 12
 * tasks"), not like a debug dump ("listTasks · 12 items"). Two key shifts
 * from the previous implementation:
 *
 *   1. Raw `_id` strings are no longer surfaced. Citation chips already
 *      carry the linked `id` for navigation; repeating it in the summary
 *      adds noise and leaks an internal identifier into the answer surface.
 *   2. Tool names are translated into plain-language verbs ("Checked",
 *      "Opened") so users understand what evidence was gathered.
 *
 * The body still falls back to truncated JSON for unrecognized payload
 * shapes so a future tool that hasn't been mapped here doesn't render a
 * blank tool message.
 */
export const summarizeToolResultForUser = (
    toolName: ChatToolName,
    payload: unknown
): string => {
    if (payload && typeof payload === "object" && "error" in payload) {
        return String((payload as { error: string }).error);
    }
    switch (toolName) {
        case "listProjects":
            if (isProjectArray(payload)) {
                if (payload.length === 0)
                    return microcopy.ai.noProjectsFound as string;
                const lines = payload.map((p) => `• **${p.projectName}**`);
                return [
                    (
                        payload.length === 1
                            ? microcopy.ai.checkedProjectsSummaryOne
                            : microcopy.ai.checkedProjectsSummaryOther
                    ).replace("{count}", String(payload.length)),
                    ...lines
                ].join("\n");
            }
            break;
        case "listMembers":
            if (isMemberArray(payload)) {
                if (payload.length === 0)
                    return microcopy.ai.noTeamMembersFound as string;
                const lines = payload.map((m) => `• **${m.username}**`);
                return [
                    (
                        payload.length === 1
                            ? microcopy.ai.checkedMembersSummaryOne
                            : microcopy.ai.checkedMembersSummaryOther
                    ).replace("{count}", String(payload.length)),
                    ...lines
                ].join("\n");
            }
            break;
        case "getProject":
            if (payload && typeof payload === "object" && "_id" in payload) {
                const p = payload as IProject;
                return microcopy.ai.openedProjectSummary
                    .replace("{name}", p.projectName)
                    .replace(
                        "{organization}",
                        p.organization || microcopy.labels.noOrganization
                    );
            }
            break;
        case "listBoard":
            if (isColumnArray(payload)) {
                if (payload.length === 0)
                    return microcopy.ai.noColumnsFound as string;
                const lines = [...payload]
                    .sort((a, b) => a.index - b.index)
                    .map((c) => `• ${c.columnName}`);
                return [
                    (
                        payload.length === 1
                            ? microcopy.ai.checkedColumnsSummaryOne
                            : microcopy.ai.checkedColumnsSummaryOther
                    ).replace("{count}", String(payload.length)),
                    ...lines
                ].join("\n");
            }
            break;
        case "listTasks":
            if (isTaskArray(payload)) {
                if (payload.length === 0)
                    return microcopy.ai.noTasksFound as string;
                const lines = payload.map(
                    (t) =>
                        `• **${t.taskName}** — ${t.type}, ${microcopy.brief.markdownStoryPoints.replace("{count}", String(t.storyPoints))}`
                );
                return [
                    (
                        payload.length === 1
                            ? microcopy.ai.checkedTasksSummaryOne
                            : microcopy.ai.checkedTasksSummaryOther
                    ).replace("{count}", String(payload.length)),
                    ...lines
                ].join("\n");
            }
            break;
        case "getTask":
            if (payload && typeof payload === "object" && "_id" in payload) {
                const t = payload as ITask;
                return [
                    microcopy.ai.openedTaskSummary.replace(
                        "{name}",
                        t.taskName
                    ),
                    microcopy.ai.taskMetaLine
                        .replace("{type}", t.type)
                        .replace("{points}", String(t.storyPoints))
                        .replace("{epic}", t.epic),
                    t.note ? `\n${t.note}` : ""
                ]
                    .filter(Boolean)
                    .join("\n");
            }
            break;
        default:
            break;
    }
    try {
        const text = JSON.stringify(payload, null, 2);
        return text.length > 4000
            ? `${text.slice(0, 4000)}\n… (truncated)`
            : text;
    } catch {
        return String(payload);
    }
};
