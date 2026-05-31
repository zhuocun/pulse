import { execFileSync } from "child_process";

import { QueryClient } from "@tanstack/react-query";

import { FE_TOOL_REGISTRY } from ".";
import type { FeToolContext } from "./types";

const READ_TOOL_NAMES = [
    "fe.listProjects",
    "fe.listMembers",
    "fe.getProject",
    "fe.listBoard",
    "fe.listTasks",
    "fe.getTask",
    "fe.boardSnapshot",
    "fe.similarTasks",
    "fe.searchCandidates"
] as const;

type ReadToolName = (typeof READ_TOOL_NAMES)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

const loadBackendRequiredKeys = (): Record<string, string[]> => {
    const script = [
        "import json",
        "from app.tools.fe_tool_schemas import FE_TOOL_SCHEMAS",
        "print(json.dumps({",
        "    name: schema.get('result_schema', {}).get('required', [])",
        "    for name, schema in FE_TOOL_SCHEMAS.items()",
        "}, sort_keys=True))"
    ].join("\n");
    const out = execFileSync("python3", ["-c", script], {
        cwd: `${process.cwd()}/backend`,
        encoding: "utf8",
        env: {
            ...process.env,
            PYTHONPATH: `${process.cwd()}/backend`
        }
    });
    const parsed: unknown = JSON.parse(out);
    if (!isRecord(parsed)) {
        throw new Error("Backend FE tool schema export was not an object");
    }
    const result: Record<string, string[]> = {};
    for (const [name, keys] of Object.entries(parsed)) {
        if (
            !Array.isArray(keys) ||
            !keys.every((key) => typeof key === "string")
        ) {
            throw new Error(`Backend required keys for ${name} were malformed`);
        }
        result[name] = keys;
    }
    return result;
};

const buildCtx = (): FeToolContext => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<IProject[]>(
        ["projects"],
        [
            {
                _id: "p1",
                createdAt: "0",
                managerId: "m1",
                organization: "Acme",
                projectName: "Roadmap"
            }
        ]
    );
    queryClient.setQueryData<IMember[]>(
        ["users/members"],
        [{ _id: "m1", email: "a@b.c", username: "Alice" }]
    );
    queryClient.setQueryData<IColumn[]>(
        ["boards", { projectId: "p1" }],
        [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }]
    );
    queryClient.setQueryData<ITask[]>(
        ["tasks", { projectId: "p1" }],
        [
            {
                _id: "t1",
                columnId: "c1",
                coordinatorId: "m1",
                epic: "Auth",
                index: 0,
                note: "Fix Safari redirect",
                projectId: "p1",
                storyPoints: 3,
                taskName: "Fix login redirect",
                type: "Bug"
            }
        ]
    );
    return { queryClient, projectId: "p1", autonomyLevel: "plan" };
};

const argsFor = (name: ReadToolName): Record<string, unknown> => {
    switch (name) {
        case "fe.listProjects":
        case "fe.listMembers":
            return { project_id: "p1" };
        case "fe.getProject":
        case "fe.listBoard":
        case "fe.listTasks":
        case "fe.boardSnapshot":
            return { project_id: "p1" };
        case "fe.getTask":
            return { task_id: "t1", project_id: "p1" };
        case "fe.similarTasks":
            return { project_id: "p1", query: "login" };
        case "fe.searchCandidates":
            return { project_id: "p1", query: "login", kind: "tasks" };
    }
};

describe("FE tool result contract", () => {
    it("returns the top-level keys required by backend FE_TOOL_SCHEMAS", async () => {
        const backendRequiredKeys = loadBackendRequiredKeys();
        const ctx = buildCtx();

        for (const name of READ_TOOL_NAMES) {
            const tool = FE_TOOL_REGISTRY[name];
            expect(tool).toBeDefined();
            const requiredKeys = backendRequiredKeys[name];
            if (!requiredKeys) {
                throw new Error(`${name} is missing from backend FE schemas`);
            }
            expect(requiredKeys.length).toBeGreaterThan(0);

            const output = await tool.run(argsFor(name), ctx);
            expect(isRecord(output)).toBe(true);
            if (!isRecord(output)) {
                throw new Error(`${name} did not return an object`);
            }
            expect(Object.keys(output).sort()).toEqual(
                [...requiredKeys].sort()
            );
        }
    });
});
