/**
 * Accessibility coverage for the AI provenance & transparency affordances
 * (B3 — ui-todo §2.A.8).
 *
 * Two surfaces are exercised here:
 *  1. `AiWhyPopover` — the new "Why?" rationale disclosure. We assert it
 *     has an accessible name, is keyboard-operable (opens via click /
 *     keyboard on a real <button>), reveals the existing rationale text,
 *     and passes a jest-axe audit in both closed and open states.
 *  2. `AiTaskAssistPanel` — rendered with a populated local-engine
 *     suggestion so the embedded "Why?" affordance is present, then
 *     audited with jest-axe.
 *
 * Heavy AI hooks are mocked so the components render without a live
 * query subscriber / network.
 */
import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import AiWhyPopover from "../components/aiWhyPopover";
import AiTaskAssistPanel from "../components/aiTaskAssistPanel";
import { microcopy, microcopyString } from "../constants/microcopy";
import { store } from "../store";

expect.extend(toHaveNoViolations);

// ─── Module mocks ───────────────────────────────────────────────────────────

jest.mock("../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "http://localhost:8080/api/v1",
        aiBaseUrl: "",
        aiEnabled: true,
        aiUseLocalEngine: true
    }
}));

jest.mock("../utils/hooks/useAi", () => ({
    __esModule: true,
    assertRunPayloadProjectsAiAllowed: jest.fn(),
    default: jest.fn(({ route }: { route: string }) => ({
        data:
            route === "estimate"
                ? {
                      storyPoints: 5,
                      confidence: 0.82,
                      rationale:
                          "Similar to three medium-sized auth tasks already on the board.",
                      similar: []
                  }
                : { issues: [] },
        error: null,
        isLoading: false,
        reset: jest.fn(),
        run: jest.fn().mockResolvedValue(null)
    }))
}));

jest.mock("../utils/hooks/useAgent", () => {
    const noop = () => undefined;
    const stub = {
        abort: noop,
        citations: [],
        clearPendingProposal: noop,
        clearSuggestion: noop,
        dismissNudge: noop,
        error: null,
        isSlowTtft: false,
        isStreaming: false,
        lastSuggestion: null,
        nudges: [],
        pendingInterrupt: null,
        pendingProposal: null,
        reset: noop,
        resume: jest.fn().mockResolvedValue(undefined),
        seedMessages: noop,
        start: jest.fn().mockResolvedValue(undefined),
        state: { messages: [] },
        status: "idle" as const,
        threadId: "stub-thread",
        ttftMs: null
    };
    return { __esModule: true, default: () => stub };
});

jest.mock("../utils/hooks/useUndoToast", () => ({
    __esModule: true,
    default: () => ({ show: jest.fn() })
}));

jest.mock("../constants/analytics", () => ({
    __esModule: true,
    ANALYTICS_EVENTS: {},
    track: jest.fn()
}));

jest.mock("../components/copilotRemoteConsentNotice", () => ({
    __esModule: true,
    default: () => null
}));

jest.mock("../components/copilotPrivacyPopover", () => {
    const ReactLib = require("react");
    return {
        __esModule: true,
        default: () =>
            ReactLib.createElement(
                "button",
                { type: "button", "aria-label": "Privacy info" },
                "Privacy"
            ),
        CopilotPrivacyDisclosure: () => null
    };
});

// ─── jsdom gaps ─────────────────────────────────────────────────────────────

beforeAll(() => {
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

    class ResizeObserverMock {
        observe = jest.fn();

        unobserve = jest.fn();

        disconnect = jest.fn();
    }

    Object.defineProperty(window, "ResizeObserver", {
        writable: true,
        value: ResizeObserverMock
    });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const whyLabel = microcopyString(microcopy.ai.whyLabel);

// Component-level audits don't render a full page, so the page-scoped
// `region` (all-content-in-a-landmark) rule isn't meaningful here — the
// host pages are covered by the strict page-level audits elsewhere.
const COMPONENT_AXE_OPTIONS = {
    rules: { region: { enabled: false } }
};

const seedClient = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(
        ["users/members"],
        [{ _id: "m1", email: "a@b.c", username: "Alice" }]
    );
    queryClient.setQueryData(
        ["boards", { projectId: "p1" }],
        [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }]
    );
    queryClient.setQueryData(["tasks", { projectId: "p1" }], []);
    return queryClient;
};

const renderPanel = () =>
    render(
        <Provider store={store}>
            <QueryClientProvider client={seedClient()}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <AiTaskAssistPanel
                                    onApplyStoryPoints={jest.fn()}
                                    onApplySuggestion={jest.fn()}
                                    onOpenSimilarTask={jest.fn()}
                                    values={{ taskName: "Build login form" }}
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AiWhyPopover", () => {
    it("renders a keyboard-operable trigger with an accessible name", () => {
        render(<AiWhyPopover rationale="Because of three similar tasks." />);
        const trigger = screen.getByRole("button", {
            name: new RegExp(`^${whyLabel.replace("?", "\\?")}`)
        });
        expect(trigger).toBeInTheDocument();
        expect(trigger.tagName).toBe("BUTTON");
    });

    it("renders nothing when there is no rationale text", () => {
        const { container } = render(<AiWhyPopover rationale="   " />);
        expect(container).toBeEmptyDOMElement();
    });

    it("is closed by default and opens to reveal the existing rationale", async () => {
        render(
            <AiWhyPopover rationale="Because of three similar auth tasks." />
        );
        const trigger = screen.getByRole("button", {
            name: new RegExp(`^${whyLabel.replace("?", "\\?")}`)
        });

        // Closed by default — rationale is not in the DOM.
        expect(
            screen.queryByText(/three similar auth tasks/)
        ).not.toBeInTheDocument();

        // Activating the trigger reveals the rationale + a titled heading.
        fireEvent.click(trigger);
        expect(
            await screen.findByText(/three similar auth tasks/)
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopyString(microcopy.ai.whyPopoverTitle))
        ).toBeInTheDocument();
    });

    it("has no axe violations closed or open", async () => {
        const { container } = render(
            <AiWhyPopover rationale="Because of three similar auth tasks." />
        );
        expect(
            await axe(container, COMPONENT_AXE_OPTIONS)
        ).toHaveNoViolations();

        fireEvent.click(
            screen.getByRole("button", {
                name: new RegExp(`^${whyLabel.replace("?", "\\?")}`)
            })
        );
        await screen.findByText(/three similar auth tasks/);
        expect(
            await axe(document.body, COMPONENT_AXE_OPTIONS)
        ).toHaveNoViolations();
    });
});

describe("AiTaskAssistPanel — Why affordance", () => {
    it("exposes a Why? affordance for the story-point estimate", async () => {
        renderPanel();
        const trigger = await screen.findByRole("button", {
            name: new RegExp(whyLabel.replace("?", "\\?"))
        });
        fireEvent.click(trigger);
        expect(
            await screen.findByText(/medium-sized auth tasks/)
        ).toBeInTheDocument();
    });

    it("has no axe violations with a populated suggestion", async () => {
        const { container } = renderPanel();
        await screen.findByRole("button", {
            name: new RegExp(whyLabel.replace("?", "\\?"))
        });
        expect(
            await axe(container, COMPONENT_AXE_OPTIONS)
        ).toHaveNoViolations();
    });
});
