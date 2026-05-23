import {
    AiContextProject,
    AiSearchProjectsContext,
    boardBrief,
    breakdownTask,
    detectEpic,
    detectType,
    draftTask,
    estimate,
    noteCompletion,
    readiness,
    semanticSearch
} from "./engine";

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "m1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const column = (overrides: Partial<IColumn> = {}): IColumn => ({
    _id: "col-todo",
    columnName: "Todo",
    index: 0,
    projectId: "p1",
    ...overrides
});

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "t1",
    columnId: "col-todo",
    coordinatorId: "m1",
    epic: "Auth",
    index: 0,
    note: "",
    projectId: "p1",
    storyPoints: 3,
    taskName: "Fix login",
    type: "Bug",
    ...overrides
});

const buildContext = (
    overrides: Partial<AiContextProject> = {}
): AiContextProject => ({
    project: { _id: "p1", projectName: "Roadmap" },
    columns: [
        column({ _id: "col-todo", columnName: "Todo", index: 0 }),
        column({ _id: "col-progress", columnName: "In Progress", index: 1 }),
        column({ _id: "col-done", columnName: "Done", index: 2 })
    ],
    members: [member(), member({ _id: "m2", username: "Bob" })],
    tasks: [
        task({ _id: "t1", taskName: "Fix flaky login", storyPoints: 3 }),
        task({
            _id: "t2",
            taskName: "Investigate slow login",
            storyPoints: 5,
            type: "Bug"
        }),
        task({
            _id: "t3",
            columnId: "col-progress",
            coordinatorId: "m2",
            epic: "Performance",
            taskName: "Optimize query throughput",
            storyPoints: 8,
            type: "Task"
        })
    ],
    ...overrides
});

describe("engine.detectType", () => {
    it("detects bug-flavoured prompts", () => {
        expect(detectType("There's a flaky test in the auth flow")).toBe("Bug");
        expect(detectType("Crash when uploading large files")).toBe("Bug");
    });

    it("falls back to Task for normal feature work", () => {
        expect(detectType("Add a settings page")).toBe("Task");
    });
});

describe("engine.detectEpic", () => {
    it("matches keyword epics", () => {
        expect(detectEpic("Add the login screen")).toBe("Auth");
        expect(detectEpic("Slow queries cause latency")).toBe("Performance");
        expect(detectEpic("Refactor the navigation menu")).toBe("Refactor");
        expect(detectEpic("Update the README documentation")).toBe(
            "Documentation"
        );
        expect(detectEpic("Increase test coverage")).toBe("Testing");
        expect(detectEpic("Polish the modal styling")).toBe("UI Polish");
        expect(detectEpic("Fix a flaky regression")).toBe("Bug Fix");
    });

    it("falls back to New Feature when nothing matches", () => {
        expect(detectEpic("Generic chore item")).toBe("New Feature");
    });
});

describe("engine.draftTask", () => {
    it("produces a complete suggestion grounded in context", () => {
        const context = buildContext();
        const suggestion = draftTask({
            prompt: "Investigate flaky login on Safari, half day, blocks v2",
            columnId: "col-todo",
            coordinatorId: "m2",
            context
        });

        expect(suggestion.taskName.length).toBeGreaterThan(0);
        expect(suggestion.type).toBe("Bug");
        // "investigate flaky login" hits the bug epic before the auth epic
        expect(["Auth", "Bug Fix"]).toContain(suggestion.epic);
        expect([1, 2, 3, 5, 8, 13]).toContain(suggestion.storyPoints);
        expect(suggestion.columnId).toBe("col-todo");
        expect(suggestion.coordinatorId).toBe("m2");
        expect(suggestion.note).toContain("Acceptance criteria");
        expect(suggestion.confidence).toBeGreaterThan(0);
        expect(suggestion.confidence).toBeLessThanOrEqual(1);
    });

    it("falls back when no column or coordinator is supplied", () => {
        const suggestion = draftTask({
            prompt: "Add a new dashboard widget for sprint velocity",
            context: buildContext()
        });
        expect(suggestion.columnId).toBe("col-todo");
        expect(suggestion.coordinatorId).toBe("m1");
        expect(suggestion.type).toBe("Task");
    });

    it("handles empty prompt safely", () => {
        const suggestion = draftTask({
            prompt: "",
            context: buildContext({ columns: [], members: [] })
        });
        expect(suggestion.taskName).toBe("Untitled task");
        expect(suggestion.columnId).toBe("");
        expect(suggestion.coordinatorId).toBe("");
    });

    it("truncates very long prompts in the task name", () => {
        const longPrompt = "A".repeat(200);
        const suggestion = draftTask({
            prompt: longPrompt,
            context: buildContext()
        });
        expect(suggestion.taskName.length).toBeLessThan(longPrompt.length);
        expect(suggestion.taskName.endsWith("…")).toBe(true);
    });

    it("scales story points to the prompt size hints", () => {
        const small = draftTask({
            prompt: "Quick typo fix in header",
            context: buildContext()
        });
        const large = draftTask({
            prompt: "Build a complex multi-step onboarding flow that integrates with five external services and requires a week of work",
            context: buildContext()
        });
        expect(small.storyPoints).toBeLessThan(large.storyPoints);
    });
});

describe("engine.breakdownTask", () => {
    it("returns 2..6 child suggestions", () => {
        const result = breakdownTask(
            { prompt: "Build dashboard", context: buildContext() },
            10
        );
        expect(result.items.length).toBeLessThanOrEqual(6);
        expect(result.items.length).toBeGreaterThanOrEqual(2);
    });

    it("shrinks story points relative to the parent", () => {
        const context = buildContext();
        const parent = draftTask({
            prompt: "Big complex week-long migration to v2",
            context
        });
        const result = breakdownTask({
            prompt: "Big complex week-long migration to v2",
            context
        });
        result.items.forEach((item) => {
            expect(item.storyPoints).toBeLessThanOrEqual(parent.storyPoints);
        });
    });
});

describe("engine.estimate", () => {
    it("uses similar past tasks when they exist", () => {
        const context = buildContext();
        const result = estimate({
            taskName: "Fix flaky login on iOS",
            tasks: context.tasks
        });
        expect(result.similar.length).toBeGreaterThan(0);
        expect([1, 2, 3, 5, 8, 13]).toContain(result.storyPoints);
        expect(result.confidence).toBeGreaterThan(0.4);
    });

    it("falls back to text length when nothing is similar", () => {
        const result = estimate({
            taskName: "Compose interplanetary haiku",
            tasks: []
        });
        expect(result.similar).toEqual([]);
        expect([1, 2, 3, 5, 8, 13]).toContain(result.storyPoints);
        expect(result.confidence).toBeGreaterThan(0);
    });

    it("excludes the task being edited from its own similar set", () => {
        const context = buildContext();
        const result = estimate({
            taskName: "Fix flaky login",
            tasks: context.tasks,
            excludeTaskId: "t1"
        });
        expect(
            result.similar.find((entry) => entry._id === "t1")
        ).toBeUndefined();
    });

    it("ignores mock and invalid story-point tasks", () => {
        const result = estimate({
            taskName: "Fix login",
            tasks: [
                task({ _id: "mock", taskName: "Fix login mock" }),
                task({ _id: "bad", taskName: "Fix login bad", storyPoints: 4 })
            ]
        });
        expect(result.similar.length).toBe(0);
    });

    it("returns a fallback with low confidence when task title hint matched", () => {
        const result = estimate({
            taskName: "trivial typo fix",
            tasks: []
        });
        expect(result.confidence).toBeGreaterThan(0.5);
    });
});

describe("engine.readiness", () => {
    it("flags every missing field with severities", () => {
        const report = readiness({ taskName: "Hi" });
        const fields = report.issues.map((issue) => issue.field).sort();
        expect(fields).toEqual(
            expect.arrayContaining([
                "coordinatorId",
                "epic",
                "note",
                "taskName",
                "type"
            ])
        );
    });

    it("returns no issues when fully populated", () => {
        const report = readiness({
            taskName: "Fix login regression",
            note: "## Acceptance criteria\n- Login works",
            epic: "Auth",
            type: "Bug",
            coordinatorId: "m1"
        });
        expect(report.issues).toEqual([]);
    });

    it("downgrades note to info when content exists but criteria are missing", () => {
        const report = readiness({
            taskName: "Fix login regression",
            note: "Some context only",
            epic: "Auth",
            type: "Bug",
            coordinatorId: "m1"
        });
        const noteIssue = report.issues.find((issue) => issue.field === "note");
        expect(noteIssue?.severity).toBe("info");
    });
});

describe("engine.boardBrief", () => {
    it("counts per column, picks largest unstarted, and surfaces unowned", () => {
        const context = buildContext();
        const brief = boardBrief(context);
        expect(brief.headline).toMatch(/3 tasks/);
        expect(brief.counts.find((c) => c.columnId === "col-todo")?.count).toBe(
            2
        );
        expect(brief.largestUnstarted[0].taskId).toBe("t2");
    });

    it("includes a recommendation about unowned tasks when present", () => {
        const context = buildContext({
            tasks: [task({ _id: "t1", coordinatorId: "ghost" })]
        });
        const brief = boardBrief(context);
        expect(brief.recommendation).toMatch(/unowned/i);
    });

    it("recommends breaking down a large unstarted task", () => {
        const context = buildContext({
            tasks: [
                task({ _id: "t1", storyPoints: 13, taskName: "Huge migration" })
            ]
        });
        const brief = boardBrief(context);
        expect(brief.recommendation).toMatch(/break/i);
    });

    it("recommends rebalancing when one member dominates and no item is large", () => {
        const context = buildContext({
            tasks: [
                task({
                    _id: "t1",
                    coordinatorId: "m1",
                    storyPoints: 5,
                    columnId: "col-progress"
                }),
                task({
                    _id: "t2",
                    coordinatorId: "m1",
                    storyPoints: 5,
                    columnId: "col-progress"
                }),
                task({
                    _id: "t3",
                    coordinatorId: "m2",
                    storyPoints: 1,
                    columnId: "col-progress"
                })
            ]
        });
        const brief = boardBrief(context);
        expect(brief.recommendation).toMatch(/rebalanc/i);
    });

    it("falls back to a balanced message", () => {
        const context = buildContext({
            tasks: [
                task({
                    _id: "t1",
                    coordinatorId: "m1",
                    storyPoints: 1,
                    columnId: "col-progress"
                })
            ]
        });
        const brief = boardBrief(context);
        expect(brief.recommendation).toMatch(/balanced/i);
    });

    it("emits a strong recommendationDetail with sources when many unowned tasks exist", () => {
        const context = buildContext({
            tasks: [
                task({ _id: "u1", coordinatorId: "ghost" }),
                task({ _id: "u2", coordinatorId: "ghost" }),
                task({ _id: "u3", coordinatorId: "ghost" }),
                task({ _id: "u4", coordinatorId: "ghost" })
            ]
        });
        const brief = boardBrief(context);
        expect(brief.recommendationDetail).toBeDefined();
        expect(brief.recommendationDetail?.strength).toBe("strong");
        expect(brief.recommendationDetail?.sources.length).toBeGreaterThan(0);
        expect(brief.recommendationDetail?.basis).toMatch(
            /no coordinator|unowned|coordinator/i
        );
    });

    it("emits an explanatory basis even when no action is recommended", () => {
        const context = buildContext({
            tasks: [
                task({
                    _id: "t1",
                    coordinatorId: "m1",
                    storyPoints: 1,
                    columnId: "col-progress"
                })
            ]
        });
        const brief = boardBrief(context);
        expect(brief.recommendationDetail?.strength).toBe("none");
        expect(brief.recommendationDetail?.basis.length).toBeGreaterThan(0);
        expect(brief.recommendationDetail?.sources).toEqual([]);
    });
});

describe("engine.semanticSearch", () => {
    const taskCtx = (): AiContextProject =>
        buildContext({
            tasks: [
                task({
                    _id: "t-auth",
                    taskName: "Fix flaky login",
                    epic: "Auth",
                    note: "token expiry"
                }),
                task({
                    _id: "t-ui",
                    taskName: "Button spacing",
                    epic: "UI Polish",
                    note: "css"
                })
            ]
        });

    it("ranks tasks by token overlap with the query", () => {
        const out = semanticSearch("tasks", "login token auth", taskCtx());
        expect(out.ids).toContain("t-auth");
        expect(out.ids.length).toBeGreaterThan(0);
        expect(out.rationale).toMatch(/similarity/i);
    });

    it("returns empty ids when nothing matches", () => {
        const out = semanticSearch("tasks", "quantum blockchain", taskCtx());
        expect(out.ids).toEqual([]);
        expect(out.rationale).toMatch(/No semantic match/i);
    });

    it("handles whitespace-only query", () => {
        const out = semanticSearch("tasks", "   ", taskCtx());
        expect(out.ids).toEqual([]);
    });

    it("ranks projects using name, org, and manager", () => {
        const ctx: AiSearchProjectsContext = {
            projects: [
                {
                    _id: "p1",
                    createdAt: "2026-01-01",
                    managerId: "m1",
                    organization: "Acme Billing",
                    projectName: "Invoices"
                },
                {
                    _id: "p2",
                    createdAt: "2026-01-02",
                    managerId: "m2",
                    organization: "Mobile",
                    projectName: "App refresh"
                }
            ],
            members: [
                member({ _id: "m1", username: "Alice" }),
                member({ _id: "m2", username: "Bob" })
            ]
        };
        const out = semanticSearch("projects", "billing acme", ctx);
        expect(out.ids).toEqual(["p1"]);
    });

    it("returns no semantic match when the query has no meaningful tokens", () => {
        const out = semanticSearch("tasks", "a an the", taskCtx());
        expect(out.ids).toEqual([]);
        expect(out.rationale).toMatch(/No semantic match/i);
    });

    it("returns no semantic match for projects when scores are all zero", () => {
        const ctx: AiSearchProjectsContext = {
            projects: [
                {
                    _id: "p1",
                    createdAt: "2026-01-01",
                    managerId: "m1",
                    organization: "X",
                    projectName: "Y"
                }
            ],
            members: [member({ _id: "m1", username: "Z" })]
        };
        const out = semanticSearch("projects", "qqq zzz", ctx);
        expect(out.ids).toEqual([]);
        expect(out.rationale).toMatch(/No semantic match/i);
    });

    /*
     * Optimization Plan §3 P1-2 — search results must surface per-id
     * match strength bands and synonym expansion so users calibrate trust
     * in a token-overlap engine that is not actually semantic.
     */
    it("emits per-id match strength bands aligned with the result list", () => {
        const out = semanticSearch("tasks", "login token auth", taskCtx());
        expect(out.matches).toBeDefined();
        const ids = new Set(out.ids);
        expect(out.matches!.every((entry) => ids.has(entry.id))).toBe(true);
        const validBands = new Set(["strong", "moderate", "weak"]);
        expect(
            out.matches!.every((entry) => validBands.has(entry.strength))
        ).toBe(true);
    });

    it("expands queries with PM synonyms and reports the additions", () => {
        // "backlog" expands to include "todo" — tasks in a Todo column should
        // start matching even though the user never typed "todo".
        const ctx = buildContext({
            tasks: [
                task({
                    _id: "t-todo",
                    epic: "x",
                    note: "todo column",
                    taskName: "Triage incoming work"
                })
            ]
        });
        const out = semanticSearch("tasks", "backlog", ctx);
        expect(out.expandedTerms).toBeDefined();
        expect(out.expandedTerms!.join(",")).toMatch(/todo|inbox|queue/);
    });
});

describe("engine.draftTask column picking", () => {
    it("uses a valid fallback column id for bugs when no triage or backlog name matches", () => {
        const context = buildContext({
            columns: [
                column({
                    _id: "col-dev",
                    columnName: "Development",
                    index: 0
                })
            ],
            tasks: []
        });
        const suggestion = draftTask({
            prompt: "Crash on startup",
            columnId: "col-dev",
            context
        });
        expect(suggestion.type).toBe("Bug");
        expect(suggestion.columnId).toBe("col-dev");
    });
});

describe("engine.noteCompletion", () => {
    it("returns an empty string when the partial value is empty and no taskName seed exists", () => {
        expect(noteCompletion({ currentValue: "" })).toBe("");
    });

    it("seeds a scaffold when the partial value is empty but a task name is known", () => {
        const out = noteCompletion({
            taskName: "Fix login redirect",
            currentValue: ""
        });
        expect(out).toContain("## Summary");
        expect(out).toContain("Fix login redirect");
        expect(out).toContain("## Acceptance criteria");
    });

    it("completes the tail of a 'when' conjunction with a verb-phrase", () => {
        const out = noteCompletion({
            taskName: "Add login",
            currentValue: "When"
        });
        expect(out.length).toBeGreaterThan(0);
        expect(out.toLowerCase()).toContain("user");
    });

    it("seeds bullet-list completion right after a fresh '## Acceptance criteria' heading", () => {
        const out = noteCompletion({
            taskName: "Fix the broken login flow",
            currentValue:
                "## Summary\nLogin breaks for new users.\n\n## Acceptance criteria"
        });
        expect(out).toMatch(/-\s/);
        // Bug-typed acceptance copy
        expect(out.toLowerCase()).toContain("regression");
    });

    it("offers a generic continuation when the user is mid-sentence", () => {
        const out = noteCompletion({
            taskName: "Add a new project header",
            columnName: "Backlog",
            currentValue: "We want users to be able to rename projects"
        });
        expect(out.length).toBeGreaterThan(0);
        // Must not strip / duplicate the prefix
        expect(out).not.toContain(
            "We want users to be able to rename projects"
        );
    });

    it("ignores absurdly long inputs to keep latency tight", () => {
        const long = "x".repeat(5000);
        expect(noteCompletion({ currentValue: long })).toBe("");
    });

    it("uses the column name to tune sentence-boundary follow-ups", () => {
        const out = noteCompletion({
            taskName: "Add coverage for login",
            columnName: "In Progress",
            currentValue: "We shipped the login change yesterday."
        });
        expect(out.toLowerCase()).toContain("regression test");
    });

    it("returns a leading space when the prefix ends mid-word", () => {
        // taskName presence makes the suggestion deterministic for the
        // sentence-boundary branch; the "and" branch ends mid-word.
        const out = noteCompletion({
            taskName: "Investigate slow signups",
            currentValue:
                "We changed the signup form so the email field validates"
        });
        // First char is whitespace so the accept-write does not paste
        // a word boundary into the user's text.
        expect(out.startsWith(" ")).toBe(true);
    });
});
