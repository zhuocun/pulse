/* eslint-disable global-require */
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

import { microcopy } from "../constants/microcopy";
import useAiEnabled from "../utils/hooks/useAiEnabled";

import CopilotLandingPage from "./copilotLanding";

jest.mock("../utils/hooks/useAiEnabled");

const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;

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

    it("dispatches boardCopilot:openChat when the Ask CTA fires", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
        const handler = jest.fn();
        window.addEventListener("boardCopilot:openChat", handler);

        render(
            <BrowserRouter>
                <CopilotLandingPage />
            </BrowserRouter>
        );

        const askCard = screen.getByTestId("copilot-landing-ask");
        fireEvent.click(askCard);
        expect(handler).toHaveBeenCalledTimes(1);

        window.removeEventListener("boardCopilot:openChat", handler);
    });

    it("dispatches boardCopilot:openBrief when the Brief CTA fires", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
        const handler = jest.fn();
        window.addEventListener("boardCopilot:openBrief", handler);

        render(
            <BrowserRouter>
                <CopilotLandingPage />
            </BrowserRouter>
        );

        const briefCard = screen.getByTestId("copilot-landing-brief");
        fireEvent.click(briefCard);
        expect(handler).toHaveBeenCalledTimes(1);

        window.removeEventListener("boardCopilot:openBrief", handler);
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
