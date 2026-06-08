import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import { setActiveLocale } from "../../i18n/active";
import { DEFAULT_LOCALE } from "../../i18n/registry";

import type { RewriteRequest } from "../../utils/ai/rewrite";

expect.extend(toHaveNoViolations);

jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        aiUseLocalEngine: true,
        aiBaseUrl: "",
        copilotDockEnabled: true,
        taskPanelRouted: false
    }
}));

jest.mock("../../constants/analytics", () => {
    const actual = jest.requireActual("../../constants/analytics");
    return {
        __esModule: true,
        ANALYTICS_EVENTS: actual.ANALYTICS_EVENTS,
        track: jest.fn()
    };
});

const runMock = jest.fn();
const abortMock = jest.fn();
let mockRewriteReturn: {
    result: string;
    isStreaming: boolean;
    error: Error | null;
    run: (request: RewriteRequest) => void;
    abort: () => void;
};

jest.mock("../../utils/hooks/useRewrite", () => ({
    __esModule: true,
    default: () => mockRewriteReturn
}));

// eslint-disable-next-line simple-import-sort/imports
import AiRewritePanel from ".";

const mockedTrack = track as jest.MockedFunction<typeof track>;

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

const renderPanel = (
    props: Partial<React.ComponentProps<typeof AiRewritePanel>> = {}
) => {
    const onAccept = jest.fn();
    const utils = render(
        <AiRewritePanel
            note={props.note ?? "fix the bug.   it is bad."}
            onAccept={props.onAccept ?? onAccept}
            projectId={props.projectId ?? "p1"}
        />
    );
    return { ...utils, onAccept: props.onAccept ?? onAccept };
};

const openPanel = () => {
    fireEvent.click(screen.getByTestId("ai-rewrite-open"));
};

describe("AiRewritePanel", () => {
    beforeAll(installAntdBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        mockRewriteReturn = {
            result: "",
            isStreaming: false,
            error: null,
            run: runMock,
            abort: abortMock
        };
    });

    afterEach(() => {
        setActiveLocale(DEFAULT_LOCALE);
    });

    it("renders a trigger and keeps the panel collapsed until clicked", () => {
        renderPanel();
        const trigger = screen.getByTestId("ai-rewrite-open");
        expect(trigger).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByTestId("ai-rewrite-mode")).not.toBeInTheDocument();
    });

    it("opens an inline panel (note stays visible) and marks the trigger expanded", () => {
        renderPanel();
        openPanel();
        expect(screen.getByTestId("ai-rewrite-open")).toHaveAttribute(
            "aria-expanded",
            "true"
        );
        expect(screen.getByTestId("ai-rewrite-mode")).toBeInTheDocument();
    });

    it("runs a rewrite with the selected mode and the current note", () => {
        renderPanel({ note: "ship it." });
        openPanel();
        fireEvent.click(screen.getByTestId("ai-rewrite-run"));
        expect(runMock).toHaveBeenCalledTimes(1);
        expect(runMock).toHaveBeenCalledWith(
            expect.objectContaining({ mode: "polish", note: "ship it." })
        );
    });

    it("shows a plain preview and applies the rewrite on Accept (+ analytics)", () => {
        mockRewriteReturn.result = "Fix the bug. It is bad.";
        const { onAccept } = renderPanel();
        openPanel();
        const result = screen.getByTestId("ai-rewrite-result");
        expect(result).toHaveTextContent("Fix the bug. It is bad.");

        fireEvent.click(screen.getByTestId("ai-rewrite-accept"));
        expect(onAccept).toHaveBeenCalledWith("Fix the bug. It is bad.");
        expect(mockedTrack).toHaveBeenCalledWith(
            ANALYTICS_EVENTS.COPILOT_REWRITE_ACCEPT,
            expect.objectContaining({
                field: "note",
                mode: "polish",
                projectId: "p1"
            })
        );
    });

    it("does not apply anything on Cancel and aborts any stream", () => {
        mockRewriteReturn.result = "Some rewrite";
        const { onAccept } = renderPanel();
        openPanel();
        fireEvent.click(screen.getByTestId("ai-rewrite-cancel"));
        expect(onAccept).not.toHaveBeenCalled();
        expect(abortMock).toHaveBeenCalled();
        // Panel collapses back to just the trigger.
        expect(screen.queryByTestId("ai-rewrite-mode")).not.toBeInTheDocument();
    });

    it("closes on Escape, aborts the stream, and returns focus to the trigger", () => {
        mockRewriteReturn.result = "Some rewrite";
        const { onAccept } = renderPanel();
        openPanel();
        fireEvent.keyDown(screen.getByTestId("ai-rewrite-mode"), {
            key: "Escape"
        });
        expect(screen.queryByTestId("ai-rewrite-mode")).not.toBeInTheDocument();
        expect(abortMock).toHaveBeenCalled();
        expect(onAccept).not.toHaveBeenCalled();
        expect(screen.getByTestId("ai-rewrite-open")).toHaveFocus();
    });

    it("renders a line diff for a note longer than three lines", () => {
        mockRewriteReturn.result = "Line one\nLine TWO\nLine three\nLine four!";
        renderPanel({ note: "Line one\nline two\nLine three\nLine four" });
        openPanel();
        const result = screen.getByTestId("ai-rewrite-result");
        expect(
            within(result).getByRole("group", {
                name: microcopy.aiRewrite.diffLabel
            })
        ).toBeInTheDocument();
    });

    it("blocks translate/free on the local engine with an explanatory notice", () => {
        renderPanel();
        openPanel();
        fireEvent.mouseDown(
            screen.getByRole("combobox", {
                name: microcopy.aiRewrite.modeSelectAria
            })
        );
        fireEvent.click(screen.getByText(microcopy.aiRewrite.modes.free));
        expect(
            screen.getByTestId("ai-rewrite-local-unsupported")
        ).toBeInTheDocument();
        expect(screen.getByTestId("ai-rewrite-run")).toBeDisabled();
    });

    it("surfaces a streaming state on the run button", () => {
        mockRewriteReturn.isStreaming = true;
        renderPanel();
        openPanel();
        expect(screen.getByTestId("ai-rewrite-run")).toBeDisabled();
    });

    it("shows an error alert with a retry affordance", () => {
        mockRewriteReturn.error = new Error("boom");
        renderPanel();
        openPanel();
        expect(screen.getByTestId("ai-rewrite-error")).toBeInTheDocument();
    });

    it("disables the run button when the note is empty", () => {
        renderPanel({ note: "   " });
        openPanel();
        expect(screen.getByTestId("ai-rewrite-run")).toBeDisabled();
        expect(
            screen.getByText(microcopy.aiRewrite.emptyNoteHint)
        ).toBeInTheDocument();
    });

    it("renders localized copy after switching to zh-CN", () => {
        setActiveLocale("zh-CN");
        renderPanel();
        expect(screen.getByTestId("ai-rewrite-open")).toHaveTextContent(
            "用 AI 改写"
        );
    });

    it("has no axe violations with the panel open and a result shown", async () => {
        mockRewriteReturn.result = "Fix the bug. It is bad.";
        const { container } = renderPanel();
        openPanel();
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
