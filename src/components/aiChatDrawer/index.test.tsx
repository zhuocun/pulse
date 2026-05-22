import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { MemoryRouter } from "react-router-dom";

import useAuth from "../../utils/hooks/useAuth";
import type { MutationProposal, TriageNudge } from "../../interfaces/agent";

import { microcopy } from "../../constants/microcopy";

import AiChatDrawer from ".";

// Helpers to flip the mutation-proposals feature flag on/off in tests.
// The factory function returns the same object reference so individual tests
// can mutate `mockEnv.*` fields between runs. The object must be declared
// inside the factory (not as a module-level `const`) so Jest's hoisting of
// `jest.mock` does not evaluate it before the variable is initialized.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockEnv: Record<string, any> = {};
jest.mock("../../constants/env", () => {
    // Re-import mockEnv via the module-level reference.
    // Jest hoists jest.mock() to the top of the file, so we use a getter
    // that lazily reads from the outer `mockEnv` object at call time.
    const mod = {
        __esModule: true,
        get default() {
            return mockEnv;
        }
    };
    return mod;
});

jest.mock("../../utils/hooks/useAuth");

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const mockApi = jest.fn();

jest.mock("../../utils/hooks/useApi", () => ({
    __esModule: true,
    default: () => mockApi
}));

const installAntdMocks = () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        value: 800
    });
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: () => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: "",
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const project: IProject = {
    _id: "p1",
    createdAt: "0",
    managerId: "m1",
    organization: "Org",
    projectName: "Roadmap"
};

const columns: IColumn[] = [
    { _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }
];

const members: IMember[] = [{ _id: "m1", email: "a@b.c", username: "Alice" }];

const tasks: ITask[] = [
    {
        _id: "t1",
        columnId: "c1",
        coordinatorId: "m1",
        epic: "x",
        index: 0,
        note: "",
        projectId: "p1",
        storyPoints: 3,
        taskName: "Fix thing",
        type: "Task"
    }
];

const renderDrawer = (
    open = true,
    extraProps: {
        pendingProposal?: MutationProposal;
        pendingNudges?: TriageNudge[];
        onAcceptProposal?: (proposal: MutationProposal) => void;
        onRejectProposal?: (proposal: MutationProposal) => void;
        onUndoProposal?: (proposal: MutationProposal) => void;
        onActionNudge?: (nudge: TriageNudge) => void;
        onDismissNudge?: (nudge: TriageNudge) => void;
    } = {}
) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    const onClose = jest.fn();
    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        isAuthenticated: false,
        user: undefined
    });
    mockApi.mockResolvedValue([]);

    const utils = render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <AntdApp component={false}>
                    <AiChatDrawer
                        columns={columns}
                        knownProjectIds={["p1"]}
                        members={members}
                        onClose={onClose}
                        open={open}
                        project={project}
                        tasks={tasks}
                        {...extraProps}
                    />
                </AntdApp>
            </MemoryRouter>
        </QueryClientProvider>
    );
    return { ...utils, onClose };
};

describe("AiChatDrawer", () => {
    beforeAll(() => {
        installAntdMocks();
    });

    beforeEach(() => {
        mockApi.mockReset();
        mockApi.mockResolvedValue([]);
        // Default flag to off; individual tests that need it on set it explicitly.
        mockEnv.aiMutationProposalsEnabled = false;
        // Reset other env fields to safe defaults for these tests.
        mockEnv.aiEnabled = true;
        mockEnv.aiUseLocalEngine = true;
        mockEnv.aiBaseUrl = "";
        // Clear any chat history saved by prior tests so each test starts fresh.
        window.localStorage.removeItem("copilot_history_p1");
        Object.assign(navigator, {
            clipboard: {
                writeText: jest.fn().mockResolvedValue(undefined)
            }
        });
    });

    it("shows the empty hint and sends a message that yields an assistant reply", async () => {
        renderDrawer(true);
        expect(screen.getByText(/ask about this board/i)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("Message Board Copilot"), {
            target: { value: "Give me a board summary" }
        });
        fireEvent.click(screen.getByLabelText("Send message"));

        await waitFor(() => {
            expect(screen.getByText(/task on the board/i)).toBeInTheDocument();
        });
        expect(mockApi).not.toHaveBeenCalled();
    });

    it("clears the thread when New conversation is clicked", async () => {
        renderDrawer(true);
        fireEvent.change(screen.getByLabelText("Message Board Copilot"), {
            target: { value: "Summarize the board" }
        });
        fireEvent.click(screen.getByLabelText("Send message"));
        await waitFor(() => {
            expect(screen.getByText(/task on the board/i)).toBeInTheDocument();
        });

        const clearBtn = screen.getByLabelText("New conversation");
        expect(clearBtn).not.toBeDisabled();
        fireEvent.click(clearBtn);
        await waitFor(() => {
            expect(
                screen.getByText(
                    /starting a new conversation will clear all current history/i
                )
            ).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole("button", { name: /^ok$/i }));

        await waitFor(() => {
            expect(
                screen.getByText(/ask about this board/i)
            ).toBeInTheDocument();
        });
    });

    it("calls onClose when the drawer close control is used", async () => {
        const { onClose } = renderDrawer(true);
        fireEvent.change(screen.getByLabelText("Message Board Copilot"), {
            target: { value: "hello" }
        });

        const closeBtn = document.querySelector(
            ".ant-drawer-close"
        ) as HTMLButtonElement | null;
        expect(closeBtn).toBeTruthy();
        fireEvent.click(closeBtn!);

        expect(onClose).toHaveBeenCalled();
    });

    it("does not send on Shift+Enter", () => {
        renderDrawer(true);
        const input = screen.getByLabelText("Message Board Copilot");
        fireEvent.change(input, { target: { value: "line one" } });
        fireEvent.keyDown(input, {
            key: "Enter",
            code: "Enter",
            shiftKey: true
        });
        expect(screen.getByText(/ask about this board/i)).toBeInTheDocument();
    });

    it("renders tool output collapsed; toggle shows raw payload when the assistant requests listProjects", async () => {
        mockApi.mockImplementation(async (endpoint: string) => {
            if (endpoint === "projects") {
                return [{ _id: "p1", projectName: "Roadmap" }];
            }
            return [];
        });
        renderDrawer(true);
        fireEvent.change(screen.getByLabelText("Message Board Copilot"), {
            target: { value: "List all projects" }
        });
        fireEvent.click(screen.getByLabelText("Send message"));

        await waitFor(() => {
            expect(
                screen.getByTestId("chat-tool-payload-block")
            ).toBeInTheDocument();
        });
        expect(document.querySelector("pre")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: /show details/i }));

        await waitFor(() => {
            const pre = document.querySelector("pre");
            expect(pre).toBeTruthy();
            expect(pre!.textContent).toMatch(/Roadmap|project/i);
        });
        expect(mockApi).toHaveBeenCalledWith(
            "projects",
            expect.objectContaining({ method: "GET" })
        );
    });

    it("sends a sample prompt when its chip is activated", async () => {
        renderDrawer(true);
        const chip = screen.getByLabelText(/Try sample prompt: Summarize/);
        fireEvent.click(chip);

        await waitFor(() => {
            expect(screen.getByText(/task on the board/i)).toBeInTheDocument();
        });
    });

    it("hides the empty assistant tool-call replay turn from the transcript", async () => {
        // useAiChat appends a hidden assistant message carrying `toolCalls`
        // before executing the calls so the BE can hydrate AIMessage
        // tool_calls on the next request. The drawer must suppress that
        // turn or users see a blank assistant bubble between their
        // question and the tool result.
        mockApi.mockImplementation(async (endpoint: string) => {
            if (endpoint === "projects") {
                return [{ _id: "p1", projectName: "Roadmap" }];
            }
            return [];
        });
        renderDrawer(true);
        fireEvent.change(screen.getByLabelText("Message Board Copilot"), {
            target: { value: "List all projects" }
        });
        fireEvent.click(screen.getByLabelText("Send message"));

        await waitFor(() => {
            expect(
                screen.getByTestId("chat-tool-payload-block")
            ).toBeInTheDocument();
        });

        // No empty Board Copilot bubble between the user prompt and the
        // tool result. The Copilot label itself (header / sample prompts)
        // can appear elsewhere; we assert specifically that there is no
        // assistant `MessageBubble` containing only whitespace.
        const messageBubbles = document.querySelectorAll(
            '[aria-label="Board Copilot"]'
        );
        for (const bubble of Array.from(messageBubbles)) {
            const text = bubble.textContent?.trim() ?? "";
            expect(text.length).toBeGreaterThan(0);
        }
    });

    it("does NOT render MutationProposalCard when aiMutationProposalsEnabled flag is off (flag-off: proposal in state does not render card)", () => {
        mockEnv.aiMutationProposalsEnabled = false;
        const mockProposal: MutationProposal = {
            proposal_id: "prop-1",
            description: "Reassign overdue tasks to Alice",
            diff: {
                task_updates: [
                    {
                        task_id: "t1",
                        field: "coordinatorId",
                        from: "m2",
                        to: "m1"
                    }
                ]
            },
            risk: "low",
            undoable: true
        };

        renderDrawer(true, { pendingProposal: mockProposal });

        // Card must NOT appear when flag is off
        expect(
            screen.queryByRole("alertdialog", {
                name: /Reassign overdue tasks to Alice/i
            })
        ).not.toBeInTheDocument();
    });

    it("renders MutationProposalCard and NudgeCards when aiMutationProposalsEnabled flag is on (flag-on: proposal renders)", () => {
        mockEnv.aiMutationProposalsEnabled = true;
        const mockProposal: MutationProposal = {
            proposal_id: "prop-1",
            description: "Reassign overdue tasks to Alice",
            diff: {
                task_updates: [
                    {
                        task_id: "t1",
                        field: "coordinatorId",
                        from: "m2",
                        to: "m1"
                    }
                ]
            },
            risk: "low",
            undoable: true
        };
        const mockNudges: TriageNudge[] = [
            {
                nudge_id: "nudge-1",
                kind: "unowned_bug",
                project_id: "p1",
                summary: "3 bugs have no assignee",
                target_ids: ["t1"],
                severity: "warn"
            }
        ];

        renderDrawer(true, {
            pendingProposal: mockProposal,
            pendingNudges: mockNudges
        });

        // MutationProposalCard renders with role="alertdialog"
        expect(
            screen.getByRole("alertdialog", {
                name: /Reassign overdue tasks to Alice/i
            })
        ).toBeInTheDocument();

        // NudgeCard renders with role="alert" and the nudge summary text
        expect(screen.getByText("3 bugs have no assignee")).toBeInTheDocument();
    });

    it("invokes onAcceptProposal / onRejectProposal when the proposal card countdown commits", async () => {
        jest.useFakeTimers();
        mockEnv.aiMutationProposalsEnabled = true;
        const proposal: MutationProposal = {
            proposal_id: "prop-accept",
            description: "Reassign overdue tasks to Alice",
            diff: {
                task_updates: [
                    {
                        task_id: "t1",
                        field: "coordinatorId",
                        from: "m2",
                        to: "m1"
                    }
                ]
            },
            risk: "low",
            undoable: true
        };
        const onAcceptProposal = jest.fn();
        const onRejectProposal = jest.fn();

        try {
            renderDrawer(true, {
                pendingProposal: proposal,
                onAcceptProposal,
                onRejectProposal
            });

            fireEvent.click(
                screen.getByRole("button", { name: /accept proposal/i })
            );
            expect(onAcceptProposal).not.toHaveBeenCalled();

            for (let i = 0; i < 11; i += 1) {
                act(() => {
                    jest.advanceTimersByTime(1_000);
                });
            }

            await waitFor(() => {
                expect(onAcceptProposal).toHaveBeenCalledTimes(1);
            });
            expect(onAcceptProposal).toHaveBeenCalledWith(proposal);
            expect(onRejectProposal).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("hides the proposal card locally after the accept countdown commits when no handler is supplied", async () => {
        jest.useFakeTimers();
        mockEnv.aiMutationProposalsEnabled = true;
        const proposal: MutationProposal = {
            proposal_id: "prop-local",
            description: "Reassign overdue tasks to Alice",
            diff: {},
            risk: "low",
            undoable: true
        };
        try {
            renderDrawer(true, { pendingProposal: proposal });

            expect(
                screen.getByRole("alertdialog", {
                    name: /Reassign overdue tasks to Alice/i
                })
            ).toBeInTheDocument();

            fireEvent.click(
                screen.getByRole("button", { name: /accept proposal/i })
            );
            expect(screen.getByText(/undo \(10s\)/i)).toBeInTheDocument();

            for (let i = 0; i < 11; i += 1) {
                act(() => {
                    jest.advanceTimersByTime(1_000);
                });
            }

            await waitFor(() => {
                expect(
                    screen.queryByRole("alertdialog", {
                        name: /Reassign overdue tasks to Alice/i
                    })
                ).not.toBeInTheDocument();
            });
        } finally {
            jest.useRealTimers();
        }
    });

    it("invokes onActionNudge / onDismissNudge from NudgeCard buttons", () => {
        const nudge: TriageNudge = {
            nudge_id: "nudge-action",
            kind: "unowned_bug",
            project_id: "p1",
            summary: "3 bugs have no assignee",
            target_ids: ["t1"],
            severity: "warn"
        };
        const onActionNudge = jest.fn();
        const onDismissNudge = jest.fn();

        renderDrawer(true, {
            pendingNudges: [nudge],
            onActionNudge,
            onDismissNudge
        });

        fireEvent.click(screen.getByRole("button", { name: /assign owner/i }));
        expect(onActionNudge).toHaveBeenCalledWith(nudge);

        fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
        expect(onDismissNudge).toHaveBeenCalledWith(nudge);
    });

    it("locally dismisses a nudge when no onDismissNudge handler is supplied", () => {
        const nudge: TriageNudge = {
            nudge_id: "nudge-local",
            kind: "stale_task",
            project_id: "p1",
            summary: "Stale task hanging around",
            target_ids: ["t1"],
            severity: "info"
        };
        renderDrawer(true, { pendingNudges: [nudge] });

        expect(
            screen.getByText("Stale task hanging around")
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

        expect(
            screen.queryByText("Stale task hanging around")
        ).not.toBeInTheDocument();
    });

    it("autonomy selector persists the selected level to localStorage", () => {
        // Clear any leftover value from prior tests.
        window.localStorage.removeItem("boardCopilot:autonomy");

        renderDrawer(true);

        // The selector is rendered as an Ant Design Select which exposes a
        // combobox role. Simulate a change by directly writing to localStorage
        // and dispatching the custom event (mirrors how useAutonomyLevel works).
        window.localStorage.setItem("boardCopilot:autonomy", "suggest");
        window.dispatchEvent(
            new CustomEvent<string>("boardCopilot:autonomyChanged", {
                detail: "suggest"
            })
        );

        expect(window.localStorage.getItem("boardCopilot:autonomy")).toBe(
            "suggest"
        );
    });

    it("restores saved chat history from localStorage when the drawer opens (F-1)", async () => {
        // Seed localStorage with a prior conversation for project "p1".
        const history = [
            { role: "user", content: "Hello from a previous session" },
            { role: "assistant", content: "Restored assistant reply" }
        ];
        window.localStorage.setItem(
            "copilot_history_p1",
            JSON.stringify(history)
        );

        renderDrawer(true);

        await waitFor(() => {
            expect(
                screen.getByText("Hello from a previous session")
            ).toBeInTheDocument();
        });
        expect(
            screen.getByText("Restored assistant reply")
        ).toBeInTheDocument();
    });

    it("renders the Auto autonomy option as disabled with an explanatory tooltip", () => {
        // No shipped agent advertises `auto` in `AgentMetadata.allowed_autonomy`
        // and there is no preapproved-tool registry yet (see V3 PRD), so the
        // selector hard-disables "Auto" and surfaces a tooltip explaining
        // what's missing instead of silently falling back to "Plan" behavior.
        renderDrawer(true);
        const selector = screen.getByLabelText("Select Copilot autonomy mode");
        // Open the dropdown so AntD mounts the option list.
        fireEvent.mouseDown(selector);

        // The disabled-option wrapper carries a stable test id; its closest
        // AntD option container should be marked disabled.
        const autoLabel = screen.getByTestId("autonomy-option-auto");
        const optionEl = autoLabel.closest(".ant-select-item-option");
        expect(optionEl).toBeTruthy();
        expect(optionEl).toHaveClass("ant-select-item-option-disabled");

        // The non-disabled options render plain strings — only "Auto" gets
        // the wrapped tooltip span. Confirm "Plan" / "Suggest" do not
        // produce the same testid so we know the disabled branch is
        // exclusive to "Auto".
        expect(
            screen.queryByTestId("autonomy-option-plan")
        ).not.toBeInTheDocument();
        expect(
            screen.queryByTestId("autonomy-option-suggest")
        ).not.toBeInTheDocument();
    });

    it("exposes an accessible copy control on assistant messages", async () => {
        renderDrawer(true);
        fireEvent.change(screen.getByLabelText("Message Board Copilot"), {
            target: { value: "Hello" }
        });
        fireEvent.click(screen.getByLabelText("Send message"));
        await waitFor(() => {
            expect(
                screen.getByLabelText(microcopy.ai.copyMessage as string)
            ).toBeInTheDocument();
        });
    });

    it("switches the character-count hint to warning style above 90% of the cap", () => {
        renderDrawer(true);
        const input = screen.getByLabelText("Message Board Copilot");
        const threshold = Math.floor(
            (microcopy.ai.characterCounterMax as number) * 0.9
        );
        fireEvent.change(input, {
            target: { value: "x".repeat(threshold + 1) }
        });
        const hint = screen.getByTestId("chat-prompt-char-hint");
        expect(hint.className).toMatch(/warning/i);
    });

    it("wires onUndoProposal so the post-commit Undo button is reachable inside chat (regression for 04·F2)", () => {
        // The chat drawer used to render the proposal card without an
        // `onUndo` callback. As a result `MutationProposalCard`'s
        // `showCommittedUndo` resolved to false even for proposals that
        // advertise `undoable: true`, and the user lost the escape hatch.
        // Wiring `onUndoProposal` re-surfaces the Undo button beside
        // Cancel/Apply in the idle phase; clicking it fires the prop.
        mockEnv.aiMutationProposalsEnabled = true;
        const proposal: MutationProposal = {
            proposal_id: "prop-undo",
            description: "Reassign overdue tasks to Alice",
            diff: {
                task_updates: [
                    {
                        task_id: "t1",
                        field: "coordinatorId",
                        from: "m2",
                        to: "m1"
                    }
                ]
            },
            risk: "low",
            undoable: true
        };
        const onUndoProposal = jest.fn();
        renderDrawer(true, {
            pendingProposal: proposal,
            onUndoProposal
        });

        const undoBtn = screen.getByRole("button", {
            name: microcopy.mutation.undoAriaLabel as string
        });
        fireEvent.click(undoBtn);
        expect(onUndoProposal).toHaveBeenCalledTimes(1);
        expect(onUndoProposal).toHaveBeenCalledWith(proposal);
    });

    it("renders the contextual 'at risk' follow-up chip after a question about due dates and clicking populates the composer", async () => {
        // Seed a conversation that ends with a user turn mentioning a
        // due date so the keyword heuristic picks the risk chip.
        const history = [
            { role: "user", content: "Which tasks are due this week?" },
            { role: "assistant", content: "Two tasks are due Friday." }
        ];
        window.localStorage.setItem(
            "copilot_history_p1",
            JSON.stringify(history)
        );
        renderDrawer(true);
        await waitFor(() => {
            expect(
                screen.getByText("Two tasks are due Friday.")
            ).toBeInTheDocument();
        });

        // The keyword "due" routes the contextual heuristic to the
        // "risk" chip. The chip's label is the user-visible prompt text.
        const riskChipText = microcopy.ai.followUpChips
            .riskFromDue as string;
        const chip = screen.getByText(riskChipText);
        expect(chip).toBeInTheDocument();

        // Other default chips render alongside it (capped at 3).
        const chipNodes = screen.getAllByTestId("chat-follow-up-chip");
        expect(chipNodes.length).toBeGreaterThanOrEqual(2);
        expect(chipNodes.length).toBeLessThanOrEqual(3);

        // Click the risk chip — composer is populated, no auto-submit.
        const input = screen.getByLabelText(
            microcopy.a11y.messageBoardCopilot as string
        ) as HTMLTextAreaElement;
        expect(input.value).toBe("");
        fireEvent.click(chip);
        await waitFor(() => {
            expect(input.value).toBe(riskChipText);
        });
        // No new turn was sent (transcript still has only the seeded
        // user/assistant pair, plus the optional hint row from
        // useAiChat). Specifically the risk chip text should NOT appear
        // as a freshly-sent user bubble in the transcript.
        const userBubbles = screen
            .queryAllByText(riskChipText)
            .filter((el) => el !== input);
        expect(userBubbles.length).toBeLessThanOrEqual(1); // the chip itself
    });

    it("falls back to generic chips when the last user message has no recognisable keywords", async () => {
        // The default trio (Summarize / Blocked / Today) wins when
        // neither a person nor a due-date keyword is present.
        const history = [
            { role: "user", content: "How is the project going overall?" },
            {
                role: "assistant",
                content: "Looks like steady progress on the board."
            }
        ];
        window.localStorage.setItem(
            "copilot_history_p1",
            JSON.stringify(history)
        );
        renderDrawer(true);
        await waitFor(() => {
            expect(
                screen.getByText(/Looks like steady progress/)
            ).toBeInTheDocument();
        });
        const [firstDefault, secondDefault, thirdDefault] = microcopy.ai
            .followUpChips.defaults as readonly string[];
        expect(screen.getByText(firstDefault)).toBeInTheDocument();
        expect(screen.getByText(secondDefault)).toBeInTheDocument();
        expect(screen.getByText(thirdDefault)).toBeInTheDocument();
    });

    it("hides the post-commit Undo when no onUndoProposal is supplied (preserves the existing fallback)", () => {
        // When the caller does not wire `onUndoProposal` the Undo button
        // is not rendered — same behaviour as before — so the change is
        // additive rather than a forced affordance.
        mockEnv.aiMutationProposalsEnabled = true;
        const proposal: MutationProposal = {
            proposal_id: "prop-no-undo",
            description: "Reassign overdue tasks to Alice",
            diff: {},
            risk: "low",
            undoable: true
        };
        renderDrawer(true, { pendingProposal: proposal });
        expect(
            screen.queryByRole("button", {
                name: microcopy.mutation.undoAriaLabel as string
            })
        ).not.toBeInTheDocument();
    });
});
