/* eslint-disable global-require */
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

import { microcopy } from "../constants/microcopy";
import useAiChatDrawer from "../utils/hooks/useAiChatDrawer";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useBoardBriefDrawer from "../utils/hooks/useBoardBriefDrawer";

import CopilotLandingPage from "./copilotLanding";

jest.mock("../utils/hooks/useAiEnabled");
jest.mock("../utils/hooks/useAiChatDrawer");
jest.mock("../utils/hooks/useBoardBriefDrawer");

const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseAiChatDrawer = useAiChatDrawer as jest.MockedFunction<
    typeof useAiChatDrawer
>;
const mockedUseBoardBriefDrawer = useBoardBriefDrawer as jest.MockedFunction<
    typeof useBoardBriefDrawer
>;

const stubChatDrawer = (
    overrides: Partial<ReturnType<typeof useAiChatDrawer>> = {}
) =>
    ({
        open: false,
        pendingPrompt: undefined,
        openDrawer: jest.fn(),
        closeDrawer: jest.fn(),
        ...overrides
    }) as ReturnType<typeof useAiChatDrawer>;

const stubBriefDrawer = (
    overrides: Partial<ReturnType<typeof useBoardBriefDrawer>> = {}
) =>
    ({
        open: false,
        openDrawer: jest.fn(),
        closeDrawer: jest.fn(),
        ...overrides
    }) as ReturnType<typeof useBoardBriefDrawer>;

describe("CopilotLandingPage", () => {
    beforeEach(() => {
        // AntD's `<Card hoverable>` calls matchMedia during render to
        // decide whether to mount a motion variant; supply a stub.
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
        mockedUseAiChatDrawer.mockReturnValue(stubChatDrawer());
        mockedUseBoardBriefDrawer.mockReturnValue(stubBriefDrawer());
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("renders both CTAs and the page heading when AI is enabled", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });

        render(
            <BrowserRouter>
                <CopilotLandingPage />
            </BrowserRouter>
        );

        expect(
            screen.getByRole("heading", {
                level: 1,
                name: new RegExp(microcopy.copilotLanding.heading, "i")
            })
        ).toBeInTheDocument();
        expect(screen.getByTestId("copilot-landing-ask")).toBeInTheDocument();
        expect(screen.getByTestId("copilot-landing-brief")).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.copilotLanding.askDescription)
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.copilotLanding.briefDescription)
        ).toBeInTheDocument();
    });

    /*
     * The CTAs open their drawers via the canonical Redux hooks
     * (`useAiChatDrawer().openDrawer()`, `useBoardBriefDrawer().openDrawer()`)
     * BEFORE navigating. The previous custom-event bridge raced the
     * project-page mount on cold loads; reading from Redux on mount is
     * race-proof, and the test now asserts the downstream effect
     * (Redux open() call) rather than an intermediate window event.
     */
    it("opens the chat drawer via Redux when the Ask CTA fires", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
        const openDrawer = jest.fn();
        mockedUseAiChatDrawer.mockReturnValue(stubChatDrawer({ openDrawer }));

        render(
            <BrowserRouter>
                <CopilotLandingPage />
            </BrowserRouter>
        );

        const askCard = screen.getByTestId("copilot-landing-ask");
        fireEvent.click(askCard);
        expect(openDrawer).toHaveBeenCalledTimes(1);
    });

    it("opens the board brief drawer via Redux when the Brief CTA fires", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
        const openDrawer = jest.fn();
        mockedUseBoardBriefDrawer.mockReturnValue(
            stubBriefDrawer({ openDrawer })
        );

        render(
            <BrowserRouter>
                <CopilotLandingPage />
            </BrowserRouter>
        );

        const briefCard = screen.getByTestId("copilot-landing-brief");
        fireEvent.click(briefCard);
        expect(openDrawer).toHaveBeenCalledTimes(1);
    });

    it("renders the 'AI is off' empty state when AI is disabled", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: false,
            enabled: false,
            setEnabled: jest.fn()
        });

        render(
            <BrowserRouter>
                <CopilotLandingPage />
            </BrowserRouter>
        );

        expect(
            screen.getByTestId("copilot-landing-ai-disabled")
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.copilotLanding.aiDisabledTitle)
        ).toBeInTheDocument();
        expect(
            screen.queryByTestId("copilot-landing-ask")
        ).not.toBeInTheDocument();
        expect(
            screen.queryByTestId("copilot-landing-brief")
        ).not.toBeInTheDocument();
    });
});
