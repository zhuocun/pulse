import type { UseAgentHealthState } from "../hooks/useAgentHealth";

import { formatAgentHealthMessage } from "./agentHealthCopy";

const health = (
    overrides: Partial<UseAgentHealthState>
): UseAgentHealthState => ({
    status: "degraded",
    latencyMs: 120,
    lastChecked: Date.now(),
    ready: true,
    realProviderReady: true,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    stubMode: false,
    issues: [],
    warnings: [],
    ...overrides
});

describe("formatAgentHealthMessage", () => {
    it("prefers readiness issues over generic unavailable copy", () => {
        expect(
            formatAgentHealthMessage(
                health({
                    status: "offline",
                    ready: false,
                    realProviderReady: false,
                    issues: [
                        "ANTHROPIC_API_KEY missing -- provider explicitly set to 'anthropic'"
                    ]
                })
            )
        ).toBe(
            "Board Copilot is not ready: ANTHROPIC_API_KEY missing -- provider explicitly set to 'anthropic'"
        );
    });

    it("renders provider connectivity failures with provider detail", () => {
        expect(
            formatAgentHealthMessage(
                health({
                    status: "offline",
                    provider: "openai",
                    issues: [
                        "Provider connectivity probe failed: authentication failed"
                    ],
                    providerConnectivity: {
                        reachable: false,
                        detail: "authentication failed",
                        checkedAt: 1_717_200_000.123
                    }
                })
            )
        ).toBe("Board Copilot cannot reach openai: authentication failed");
    });

    it("renders stub mode and no-real-provider degraded states", () => {
        expect(
            formatAgentHealthMessage(
                health({
                    realProviderReady: false,
                    stubMode: true
                })
            )
        ).toBe(
            "Board Copilot is connected, but the server is using the stub provider instead of a real LLM."
        );

        expect(
            formatAgentHealthMessage(
                health({
                    realProviderReady: false
                })
            )
        ).toBe(
            "Board Copilot is connected, but no real LLM provider is ready."
        );
    });

    it("renders warnings, offline fallback, and degraded fallback", () => {
        expect(
            formatAgentHealthMessage(
                health({
                    warnings: ["CORS_ORIGINS is localhost-only"]
                })
            )
        ).toBe("Board Copilot is degraded: CORS_ORIGINS is localhost-only");

        expect(
            formatAgentHealthMessage(
                health({
                    status: "offline"
                })
            )
        ).toBe("Board Copilot is currently unavailable. Try again later.");

        expect(formatAgentHealthMessage(health({}))).toBe(
            "Board Copilot is experiencing delays. Responses may be slow or unavailable."
        );
    });
});
