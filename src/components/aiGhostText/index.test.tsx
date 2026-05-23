import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { Input } from "antd";
import { useState } from "react";

import AiGhostText from ".";

/**
 * Mock the environment flag and the privacy-consent state on a per-test
 * basis. The component reads `environment.aiGhostTextEnabled` at render
 * time and `localStorage` lazily via `usePrivacyConsent`, so a test that
 * needs the active surface must seed both before the first render.
 */
jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "/api/v1",
        aiBaseUrl: "",
        aiEnabled: true,
        aiUseLocalEngine: true,
        aiMutationProposalsEnabled: true,
        aiKnowledgeCutoff: "January 2026",
        bottomNavEnabled: true,
        taskPanelRouted: false,
        copilotDockEnabled: false,
        aiColumnReadinessEnabled: false,
        aiGhostTextEnabled: false
    }
}));

const setFlag = (value: boolean) => {
    jest.requireMock("../../constants/env").default.aiGhostTextEnabled = value;
};

const PRIVACY_KEY = "boardCopilot:privacyShown:task-note";

const grantConsent = () => {
    window.localStorage.setItem(PRIVACY_KEY, "1");
};

const installAntdBrowserMocks = (matches = false) => {
    // setupTests.ts already wires matchMedia as `writable: true`. We
    // overwrite the value (rather than re-define the property) so the
    // descriptor's existing flags stick — `Object.defineProperty` would
    // throw `Cannot redefine property` here in jsdom.
    (
        window as unknown as { matchMedia: (query: string) => MediaQueryList }
    ).matchMedia = ((query: string) => ({
        addEventListener: jest.fn(),
        addListener: jest.fn(),
        dispatchEvent: jest.fn(),
        matches: query.includes("prefers-reduced-motion") ? matches : false,
        media: query,
        onchange: null,
        removeEventListener: jest.fn(),
        removeListener: jest.fn()
    })) as unknown as (query: string) => MediaQueryList;
};

/**
 * Tiny controlled host so the wrapped textarea mirrors a real form
 * field. Exposes `onChange` so tests can introspect the final value
 * after Tab-accept.
 */
const Host: React.FC<{
    initial?: string;
    onChangeSpy?: jest.Mock;
    taskName?: string;
    columnName?: string;
}> = ({
    initial = "",
    onChangeSpy,
    taskName = "Fix the login redirect bug",
    columnName = "Backlog"
}) => {
    const [value, setValue] = useState(initial);
    return (
        <AiGhostText
            route="task-note"
            context={{
                projectName: "Pulse",
                columnName,
                taskName,
                currentValue: value
            }}
        >
            <Input.TextArea
                aria-label="task-note"
                rows={4}
                onChange={(event) => {
                    setValue(event.target.value);
                    onChangeSpy?.(event.target.value);
                }}
                value={value}
            />
        </AiGhostText>
    );
};

beforeEach(() => {
    jest.useFakeTimers();
    installAntdBrowserMocks(false);
    window.localStorage.clear();
    setFlag(false);
});

afterEach(() => {
    act(() => {
        jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
});

describe("AiGhostText", () => {
    it("renders the wrapped textarea unchanged when the flag is off", () => {
        setFlag(false);
        grantConsent();
        render(<Host />);
        expect(screen.getByLabelText("task-note")).toBeInTheDocument();
        expect(
            screen.queryByTestId("ai-ghost-text-overlay")
        ).not.toBeInTheDocument();
        // No wrapper shell when the surface is disabled — the textarea
        // is the direct rendered element.
        expect(screen.queryByTestId("ai-ghost-text")).not.toBeInTheDocument();
    });

    it("renders the wrapped textarea unchanged when consent is not given", () => {
        setFlag(true);
        // localStorage cleared in beforeEach → no consent
        render(<Host />);
        expect(screen.getByLabelText("task-note")).toBeInTheDocument();
        expect(
            screen.queryByTestId("ai-ghost-text-overlay")
        ).not.toBeInTheDocument();
        expect(screen.queryByTestId("ai-ghost-text")).not.toBeInTheDocument();
    });

    it("shows a suggestion in the overlay after the 600 ms debounce", async () => {
        setFlag(true);
        grantConsent();
        render(<Host taskName="Fix the login redirect bug" />);
        const textarea = screen.getByLabelText(
            "task-note"
        ) as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, {
                target: {
                    value: "Customers cannot complete checkout after sign-in"
                }
            });
        });
        // Before the 600 ms tick, no overlay yet
        expect(
            screen.queryByTestId("ai-ghost-text-overlay")
        ).not.toBeInTheDocument();
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        await waitFor(() => {
            expect(
                screen.getByTestId("ai-ghost-text-overlay")
            ).toBeInTheDocument();
        });
    });

    it("accepts the suggestion when Tab is pressed and fires onChange with the full text", async () => {
        setFlag(true);
        grantConsent();
        const onChangeSpy = jest.fn();
        render(
            <Host onChangeSpy={onChangeSpy} taskName="Login redirect bug" />
        );
        const textarea = screen.getByLabelText(
            "task-note"
        ) as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, {
                target: { value: "Repro: open the app on iOS Safari" }
            });
        });
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        // Overlay should now be visible
        await waitFor(() => {
            expect(
                screen.getByTestId("ai-ghost-text-overlay")
            ).toBeInTheDocument();
        });
        // Tab to accept
        await act(async () => {
            fireEvent.keyDown(textarea, {
                key: "Tab",
                code: "Tab"
            });
        });
        // onChange must have fired again with the appended completion
        expect(onChangeSpy).toHaveBeenCalled();
        const lastValue = onChangeSpy.mock.calls.at(-1)?.[0];
        expect(typeof lastValue).toBe("string");
        // The accepted text must contain the original prefix.
        expect(lastValue).toContain("Repro: open the app on iOS Safari");
        // And the prefix must be a proper prefix — accept must not
        // delete or duplicate what the user typed.
        expect(
            (lastValue as string).startsWith(
                "Repro: open the app on iOS Safari"
            )
        ).toBe(true);
        // Length grew — confirms the completion was appended, not just
        // a re-fire of the original value.
        expect((lastValue as string).length).toBeGreaterThan(
            "Repro: open the app on iOS Safari".length
        );
        // Textarea's own value updated to the new content too.
        expect(textarea.value).toBe(lastValue);
    });

    it("dismisses the suggestion when Esc is pressed without touching the textarea value", async () => {
        setFlag(true);
        grantConsent();
        const onChangeSpy = jest.fn();
        render(<Host onChangeSpy={onChangeSpy} />);
        const textarea = screen.getByLabelText(
            "task-note"
        ) as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, {
                target: { value: "Customers cannot complete checkout" }
            });
        });
        onChangeSpy.mockClear();
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        await waitFor(() => {
            expect(
                screen.getByTestId("ai-ghost-text-overlay")
            ).toBeInTheDocument();
        });
        await act(async () => {
            fireEvent.keyDown(textarea, {
                key: "Escape",
                code: "Escape"
            });
        });
        // Overlay gone
        await waitFor(() => {
            expect(
                screen.queryByTestId("ai-ghost-text-overlay")
            ).not.toBeInTheDocument();
        });
        // onChange must NOT have fired from the Esc — dismiss is overlay-only
        expect(onChangeSpy).not.toHaveBeenCalled();
        // Textarea value unchanged
        expect(textarea.value).toBe("Customers cannot complete checkout");
    });

    it("suppresses the debounce while IME composition is active", async () => {
        setFlag(true);
        grantConsent();
        render(<Host />);
        const textarea = screen.getByLabelText(
            "task-note"
        ) as HTMLTextAreaElement;
        // Start composition before typing
        await act(async () => {
            fireEvent.compositionStart(textarea);
        });
        await act(async () => {
            fireEvent.change(textarea, {
                target: { value: "ピンインで入力中" }
            });
        });
        // 1 second is well past the 600 ms debounce — but composition
        // is still active so no engine call should fire.
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });
        expect(
            screen.queryByTestId("ai-ghost-text-overlay")
        ).not.toBeInTheDocument();
        // End composition. The next change tick re-arms the debounce
        // (this is what Wave 1 quick win #2 already does for chat).
        await act(async () => {
            fireEvent.compositionEnd(textarea);
        });
        // Force another change to trigger the debounce now that
        // composition has ended.
        await act(async () => {
            fireEvent.change(textarea, {
                target: { value: "Customers cannot reproduce the issue" }
            });
        });
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        await waitFor(() => {
            expect(
                screen.getByTestId("ai-ghost-text-overlay")
            ).toBeInTheDocument();
        });
    });

    it("renders without a fade-in transition when prefers-reduced-motion is set", async () => {
        setFlag(true);
        grantConsent();
        installAntdBrowserMocks(true);
        render(<Host taskName="Login redirect bug" />);
        const textarea = screen.getByLabelText(
            "task-note"
        ) as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, {
                target: { value: "Repro: open the app on iOS" }
            });
        });
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        const overlay = await screen.findByTestId("ai-ghost-text-overlay");
        expect(overlay.getAttribute("data-reduced-motion")).toBe("true");
        // The actual inline transition style is `none` when reduced
        // motion is requested.
        const transition = (overlay as HTMLElement).style.transition;
        expect(transition).toBe("none");
    });

    it("suppresses Tab-accept while IME composition is active", async () => {
        setFlag(true);
        grantConsent();
        const onChangeSpy = jest.fn();
        render(
            <Host onChangeSpy={onChangeSpy} taskName="Login redirect bug" />
        );
        const textarea = screen.getByLabelText(
            "task-note"
        ) as HTMLTextAreaElement;
        // Get a suggestion first
        await act(async () => {
            fireEvent.change(textarea, {
                target: { value: "Repro: open the app on iOS Safari" }
            });
        });
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        await waitFor(() => {
            expect(
                screen.getByTestId("ai-ghost-text-overlay")
            ).toBeInTheDocument();
        });
        onChangeSpy.mockClear();
        // Now Tab while composing — the wrapper must NOT accept.
        await act(async () => {
            fireEvent.compositionStart(textarea);
        });
        await act(async () => {
            fireEvent.keyDown(textarea, {
                key: "Tab",
                code: "Tab",
                isComposing: true
            });
        });
        expect(onChangeSpy).not.toHaveBeenCalled();
    });
});
