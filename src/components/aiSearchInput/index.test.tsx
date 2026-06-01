import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { microcopy } from "../../constants/microcopy";
import useAiEnabled from "../../utils/hooks/useAiEnabled";

import AiSearchInput from ".";

jest.mock("../../utils/hooks/useAiEnabled");
jest.mock("../../utils/hooks/useAgent", () => ({
    __esModule: true,
    default: () => ({
        start: jest.fn().mockResolvedValue(undefined),
        resume: jest.fn().mockResolvedValue(undefined),
        abort: jest.fn(),
        isStreaming: false,
        state: { messages: [] },
        pendingInterrupt: null,
        pendingProposal: null,
        citations: [],
        nudges: [],
        lastSuggestion: null,
        error: null,
        reset: jest.fn(),
        threadId: "t_test",
        ttftMs: null,
        clearPendingProposal: jest.fn(),
        clearSuggestion: jest.fn(),
        dismissNudge: jest.fn()
    })
}));

const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;

const installAntdBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const projectContext = {
    project: { _id: "p1", projectName: "Roadmap" },
    columns: [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }],
    members: [{ _id: "m1", email: "a@b.c", username: "Alice" }],
    tasks: [
        {
            _id: "t-login",
            columnId: "c1",
            coordinatorId: "m1",
            epic: "Auth",
            index: 0,
            note: "token expiry",
            projectId: "p1",
            storyPoints: 3,
            taskName: "Fix flaky login",
            type: "Bug"
        },
        {
            _id: "t-ui",
            columnId: "c1",
            coordinatorId: "m1",
            epic: "UI",
            index: 1,
            note: "",
            projectId: "p1",
            storyPoints: 1,
            taskName: "Spacing tweak",
            type: "Task"
        }
    ]
};

describe("AiSearchInput", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
        localStorage.removeItem("boardCopilot:disabledProjectIds");
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("does not show Clear AI search when semanticIds is null (URL missing param)", () => {
        render(
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds={null}
                setSemanticIds={jest.fn()}
            />
        );
        expect(
            screen.queryByLabelText("Clear AI search")
        ).not.toBeInTheDocument();
    });

    it("returns null when AI is disabled at runtime", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: false,
            setEnabled: jest.fn()
        });
        const setSemanticIds = jest.fn();
        const { container } = render(
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds={undefined}
                setSemanticIds={setSemanticIds}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it("blocks local semantic search when project AI is disabled for that project", async () => {
        localStorage.setItem(
            "boardCopilot:disabledProjectIds",
            JSON.stringify(["p1"])
        );
        const setSemanticIds = jest.fn();
        render(
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds={undefined}
                setSemanticIds={setSemanticIds}
            />
        );

        fireEvent.change(
            screen.getByRole("textbox", {
                name: /Find related tasks with AI/i
            }),
            {
                target: { value: "login token flaky" }
            }
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: microcopy.ai.findRelatedTasks
            })
        );

        await waitFor(() => {
            expect(
                screen.getAllByText(
                    /Board Copilot is turned off for this project/i
                ).length
            ).toBeGreaterThan(0);
        });
        expect(setSemanticIds).not.toHaveBeenCalled();
    });

    it("runs local semantic search and sets matching task ids", async () => {
        const setSemanticIds = jest.fn();
        render(
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds={undefined}
                setSemanticIds={setSemanticIds}
            />
        );

        fireEvent.change(
            screen.getByRole("textbox", {
                name: /Find related tasks with AI/i
            }),
            {
                target: { value: "login token flaky" }
            }
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: microcopy.ai.findRelatedTasks
            })
        );

        await waitFor(() => {
            expect(setSemanticIds).toHaveBeenCalled();
        });
        const call = setSemanticIds.mock.calls[0][0] as string;
        expect(call.split(",")).toContain("t-login");
    });

    it("runs search when Enter is pressed in the natural language field", async () => {
        const setSemanticIds = jest.fn();
        render(
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds={undefined}
                setSemanticIds={setSemanticIds}
            />
        );

        fireEvent.change(
            screen.getByRole("textbox", {
                name: /Find related tasks with AI/i
            }),
            {
                target: { value: "login token flaky" }
            }
        );
        fireEvent.keyDown(
            screen.getByRole("textbox", {
                name: /Find related tasks with AI/i
            }),
            {
                key: "Enter",
                code: "Enter"
            }
        );

        await waitFor(() => {
            expect(setSemanticIds).toHaveBeenCalled();
        });
    });

    it("shows a hint when no tasks match", async () => {
        const setSemanticIds = jest.fn();
        render(
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds={undefined}
                setSemanticIds={setSemanticIds}
            />
        );

        fireEvent.change(
            screen.getByRole("textbox", {
                name: /Find related tasks with AI/i
            }),
            {
                target: { value: "quantum entanglement" }
            }
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: microcopy.ai.findRelatedTasks
            })
        );

        await waitFor(() => {
            expect(
                screen.getAllByText(/No semantic match|No tasks matched/i)
                    .length
            ).toBeGreaterThan(0);
        });
        expect(setSemanticIds).toHaveBeenCalledWith(undefined);
    });

    it("clears semantic ids from the clear button", () => {
        const setSemanticIds = jest.fn();
        render(
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds="t-login"
                setSemanticIds={setSemanticIds}
            />
        );

        fireEvent.click(screen.getByLabelText("Clear AI search"));
        expect(setSemanticIds).toHaveBeenCalledWith(undefined);
    });

    it("makes reformulation chips keyboard-reachable", async () => {
        const setSemanticIds = jest.fn();
        render(
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds={undefined}
                setSemanticIds={setSemanticIds}
            />
        );

        fireEvent.change(
            screen.getByRole("textbox", {
                name: /Find related tasks with AI/i
            }),
            {
                target: { value: "quantum entanglement" }
            }
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: microcopy.ai.findRelatedTasks
            })
        );

        const reformulation = await screen.findByRole("button", {
            name: "tasks about quantum entanglement"
        });
        expect(reformulation).toHaveAttribute("tabindex", "0");

        fireEvent.keyDown(reformulation, { key: "Enter", code: "Enter" });
        await waitFor(() => {
            expect(setSemanticIds).toHaveBeenCalledTimes(2);
        });
    });
});
