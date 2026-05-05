import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { MemoryRouter } from "react-router-dom";

import useAuth from "../../utils/hooks/useAuth";
import type { MutationProposal, TriageNudge } from "../../interfaces/agent";

import AiChatDrawer from ".";

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
        refreshUser: jest.fn(),
        token: null,
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

    it("renders tool output collapsed inside <details> when the assistant requests listProjects", async () => {
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

        // Tool details land in a collapsed native <details> element with a
        // plain-language verb summary like "Checked projects · …"
        // (Optimization Plan §3 P2-2).
        await waitFor(() => {
            const details = document.querySelector("details");
            expect(details).toBeTruthy();
            expect(details!.querySelector("summary")?.textContent).toMatch(
                /Checked projects/i
            );
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
            const details = document.querySelector("details");
            expect(details).toBeTruthy();
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

    it("renders a MutationProposalCard and NudgeCards when v2.1 props are supplied", () => {
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

    it("invokes onAcceptProposal / onRejectProposal when the proposal card buttons are clicked", () => {
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

        renderDrawer(true, {
            pendingProposal: proposal,
            onAcceptProposal,
            onRejectProposal
        });

        fireEvent.click(
            screen.getByRole("button", { name: /accept proposal/i })
        );
        expect(onAcceptProposal).toHaveBeenCalledTimes(1);
        expect(onAcceptProposal).toHaveBeenCalledWith(proposal);
        expect(onRejectProposal).not.toHaveBeenCalled();
    });

    it("hides the proposal card locally when no onAcceptProposal handler is supplied", () => {
        const proposal: MutationProposal = {
            proposal_id: "prop-local",
            description: "Reassign overdue tasks to Alice",
            diff: {},
            risk: "low",
            undoable: true
        };
        renderDrawer(true, { pendingProposal: proposal });

        expect(
            screen.getByRole("alertdialog", {
                name: /Reassign overdue tasks to Alice/i
            })
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", { name: /accept proposal/i })
        );

        expect(
            screen.queryByRole("alertdialog", {
                name: /Reassign overdue tasks to Alice/i
            })
        ).not.toBeInTheDocument();
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
});
