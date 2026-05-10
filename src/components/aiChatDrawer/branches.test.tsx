import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { MemoryRouter } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import type { AiChatMessage } from "../../utils/ai/chatEngine";
import useAuth from "../../utils/hooks/useAuth";

jest.mock("../../utils/hooks/useAiChat", () => ({
    __esModule: true,
    default: jest.fn()
}));

// eslint-disable-next-line simple-import-sort/imports
import useAiChat from "../../utils/hooks/useAiChat";

import AiChatDrawer from ".";

jest.mock("../../utils/hooks/useAuth");

const mockedUseAiChat = useAiChat as jest.MockedFunction<typeof useAiChat>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const baseChat = () => ({
    abort: jest.fn(),
    dismissError: jest.fn(),
    error: null as Error | null,
    isLoading: false,
    messages: [] as AiChatMessage[],
    reset: jest.fn(),
    seedMessages: jest.fn(),
    send: jest.fn(),
    streamingText: ""
});

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

describe("AiChatDrawer UI branches (mocked chat hook)", () => {
    beforeEach(() => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            refreshUser: jest.fn(),
            token: null,
            user: undefined
        });
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
            configurable: true,
            value: 800
        });
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
            configurable: true,
            value: 120
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
    });

    const renderDrawer = () =>
        render(
            <QueryClientProvider
                client={
                    new QueryClient({
                        defaultOptions: { queries: { retry: false } }
                    })
                }
            >
                <MemoryRouter>
                    <AntdApp component={false}>
                        <AiChatDrawer
                            columns={columns}
                            knownProjectIds={["p1"]}
                            members={members}
                            onClose={jest.fn()}
                            open
                            project={project}
                            tasks={tasks}
                        />
                    </AntdApp>
                </MemoryRouter>
            </QueryClientProvider>
        );

    it("shows streaming text while loading", () => {
        mockedUseAiChat.mockReturnValue({
            ...baseChat(),
            isLoading: true,
            streamingText: "Working…"
        });
        renderDrawer();
        expect(screen.getByText("Working…")).toBeInTheDocument();
    });

    it("renders tool rows inside collapsed <details> with a human-readable summary", () => {
        mockedUseAiChat.mockReturnValue({
            ...baseChat(),
            messages: [{ role: "tool", content: "payload" }]
        });
        renderDrawer();
        const details = document.querySelector("details");
        expect(details).toBeTruthy();
        expect(details!.querySelector("summary")?.textContent).toMatch(
            /Looked up/i
        );
        // The raw payload still renders inside the <details> body so power
        // users can expand to inspect it; the summary is the user-facing copy.
        expect(details!.textContent).toContain("payload");
    });

    it("renders the chat-bubble skeleton (not a Spin) while loading with no streaming text", () => {
        jest.useFakeTimers();
        mockedUseAiChat.mockReturnValue({
            ...baseChat(),
            isLoading: true,
            streamingText: ""
        });
        renderDrawer();

        // The delayed spinner should suppress immediate loading flash.
        expect(document.querySelector(".ant-skeleton")).toBeNull();
        expect(screen.queryByText(microcopy.ai.thinkingDefault)).toBeNull();

        act(() => {
            jest.advanceTimersByTime(260);
        });

        // After the delay, loading UI appears as the assistant skeleton bubble.
        expect(document.querySelector(".ant-skeleton")).toBeTruthy();
        expect(document.querySelector(".ant-spin")).toBeNull();
        expect(
            screen.getByText(microcopy.ai.thinkingDefault)
        ).toBeInTheDocument();
        jest.useRealTimers();
    });

    it("renders streamingText inside the bubble with a blinking cursor while loading", () => {
        mockedUseAiChat.mockReturnValue({
            ...baseChat(),
            isLoading: true,
            streamingText: "Reading tasks…"
        });
        renderDrawer();
        // The skeleton is replaced by partial output once tokens land.
        expect(screen.getByText(/Reading tasks…/)).toBeInTheDocument();
        // The cursor is decorative — assert by the glyph rather than role.
        expect(document.body.textContent).toContain("▍");
    });

    it("labels each assistant bubble with 'Board Copilot' attribution and the AI disclaimer", () => {
        mockedUseAiChat.mockReturnValue({
            ...baseChat(),
            messages: [
                { role: "user", content: "Hi" },
                { role: "assistant", content: "Hello back" }
            ]
        });
        renderDrawer();
        // P2-5: model attribution appears above the bubble exactly once.
        const copilotLabels = screen
            .getAllByText(microcopy.ai.copilotLabel)
            .filter((el) => el.tagName.toLowerCase() === "span");
        expect(copilotLabels.length).toBeGreaterThanOrEqual(1);
        // P2-2: subtle "AI · review before using" disclaimer below the bubble.
        // The drawer header already has it as a Tag; the per-message version
        // is a sibling div of the bubble inside the assistant group.
        const groups = screen.getAllByRole("group");
        const assistantGroup = groups.find((g) =>
            g.textContent?.includes("Hello back")
        );
        expect(assistantGroup).toBeTruthy();
        expect(assistantGroup!.textContent).toContain(microcopy.a11y.aiBadge);
    });

    it("tags the freshly regenerated assistant message with a Regenerated badge", () => {
        const send = jest.fn();
        const baseTurn: AiChatMessage[] = [
            { role: "user", content: "Summarize" },
            { role: "assistant", content: "First answer" }
        ];
        mockedUseAiChat.mockReturnValue({
            ...baseChat(),
            messages: baseTurn,
            send
        });
        const { rerender } = renderDrawer();

        // No badge on the first turn.
        expect(
            screen.queryByText(microcopy.ai.regeneratedBadge)
        ).not.toBeInTheDocument();

        // Click the regenerate icon button on the assistant turn.
        fireEvent.click(screen.getByLabelText("Regenerate response"));
        expect(send).toHaveBeenCalledWith("Summarize");

        // Simulate the chat hook appending a second assistant turn.
        const afterRegen: AiChatMessage[] = [
            ...baseTurn,
            { role: "user", content: "Summarize" },
            { role: "assistant", content: "Second answer" }
        ];
        mockedUseAiChat.mockReturnValue({
            ...baseChat(),
            messages: afterRegen,
            send
        });
        act(() => {
            rerender(
                <QueryClientProvider
                    client={
                        new QueryClient({
                            defaultOptions: { queries: { retry: false } }
                        })
                    }
                >
                    <MemoryRouter>
                        <AntdApp component={false}>
                            <AiChatDrawer
                                columns={columns}
                                knownProjectIds={["p1"]}
                                members={members}
                                onClose={jest.fn()}
                                open
                                project={project}
                                tasks={tasks}
                            />
                        </AntdApp>
                    </MemoryRouter>
                </QueryClientProvider>
            );
        });

        // The new assistant turn carries the Regenerated badge; the original
        // turn does not (we'd see exactly one badge).
        const badges = screen.getAllByText(microcopy.ai.regeneratedBadge);
        expect(badges.length).toBe(1);
    });

    it("shows a feedback toast on thumbs up and de-dupes repeated clicks", () => {
        mockedUseAiChat.mockReturnValue({
            ...baseChat(),
            messages: [
                { role: "user", content: "Hi" },
                { role: "assistant", content: "Hello back" }
            ]
        });
        renderDrawer();

        const thumbsUp = screen.getByLabelText("Helpful answer");
        fireEvent.click(thumbsUp);
        // The AntD App message appears in a portal under .ant-message.
        const toasts = document.querySelectorAll(".ant-message-notice");
        expect(toasts.length).toBeGreaterThan(0);
        expect(document.body.textContent).toContain(
            microcopy.ai.feedbackThanks
        );

        // A second click on the same value should be a no-op (de-duped) and
        // not stack another toast.
        const beforeCount = document.querySelectorAll(
            ".ant-message-notice"
        ).length;
        fireEvent.click(thumbsUp);
        const afterCount = document.querySelectorAll(
            ".ant-message-notice"
        ).length;
        expect(afterCount).toBe(beforeCount);
    });
});
