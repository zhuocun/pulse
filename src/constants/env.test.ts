/* eslint-disable global-require */
describe("environment", () => {
    const originalApiUrl = process.env.REACT_APP_API_URL;
    const originalAiBase = process.env.REACT_APP_AI_BASE_URL;
    const originalAiEnabled = process.env.REACT_APP_AI_ENABLED;
    const originalAiUseLocal = process.env.REACT_APP_AI_USE_LOCAL;
    const originalMutationProposals =
        process.env.REACT_APP_AI_MUTATION_PROPOSALS_ENABLED;

    afterEach(() => {
        jest.resetModules();
        process.env.REACT_APP_API_URL = originalApiUrl;
        process.env.REACT_APP_AI_BASE_URL = originalAiBase;
        process.env.REACT_APP_AI_ENABLED = originalAiEnabled;
        process.env.REACT_APP_AI_USE_LOCAL = originalAiUseLocal;
        process.env.REACT_APP_AI_MUTATION_PROPOSALS_ENABLED =
            originalMutationProposals;
    });

    it("uses a same-origin REST prefix regardless of REACT_APP_API_URL", () => {
        // REST calls go through ``/api/v1/*`` on the FE's own origin
        // (``api/index.ts`` Vercel proxy function in prod, Vite
        // proxy in dev). ``REACT_APP_API_URL`` still drives
        // ``aiBaseUrl`` for direct-to-backend AI calls, but the REST
        // base is no longer derived from it -- that's what makes the
        // HttpOnly session cookie same-origin and immune to iOS 26.5's
        // ITP-driven cross-origin cookie drop.
        process.env.REACT_APP_API_URL = "https://api.example";
        delete process.env.REACT_APP_AI_BASE_URL;
        delete process.env.REACT_APP_AI_ENABLED;
        process.env.REACT_APP_AI_USE_LOCAL = "true";

        jest.resetModules();
        const environment = require("./env").default;

        expect(environment.apiBaseUrl).toBe("/api/v1");
    });

    it("keeps the same-origin REST prefix when REACT_APP_API_URL is unset", () => {
        delete process.env.REACT_APP_API_URL;
        delete process.env.REACT_APP_AI_BASE_URL;
        delete process.env.REACT_APP_AI_ENABLED;
        process.env.REACT_APP_AI_USE_LOCAL = "true";

        jest.resetModules();
        const environment = require("./env").default;

        expect(environment.apiBaseUrl).toBe("/api/v1");
    });

    it("ignores REACT_APP_API_URL for the REST base URL at module load time", () => {
        process.env.REACT_APP_API_URL = "http://localhost:8080";
        delete process.env.REACT_APP_AI_BASE_URL;
        delete process.env.REACT_APP_AI_ENABLED;
        process.env.REACT_APP_AI_USE_LOCAL = "true";

        jest.resetModules();
        const environment = require("./env").default;

        expect(environment.apiBaseUrl).toBe("/api/v1");
    });

    it("defaults AI to enabled with the local engine when REACT_APP_AI_USE_LOCAL=true", () => {
        delete process.env.REACT_APP_AI_BASE_URL;
        delete process.env.REACT_APP_AI_ENABLED;
        process.env.REACT_APP_AI_USE_LOCAL = "true";

        jest.resetModules();
        const environment = require("./env").default;

        expect(environment.aiEnabled).toBe(true);
        expect(environment.aiBaseUrl).toBe("");
        expect(environment.aiUseLocalEngine).toBe(true);
    });

    it("defaults aiBaseUrl to apiOrigin when neither AI_BASE_URL nor AI_USE_LOCAL is set", () => {
        // Simulate a deployed (non-test) build. NODE_ENV is forced to
        // "production" so the env module's test-mode short-circuit
        // (which keeps Jest on the local engine by default) is bypassed.
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        process.env.REACT_APP_API_URL = "https://api.example";
        delete process.env.REACT_APP_AI_BASE_URL;
        delete process.env.REACT_APP_AI_ENABLED;
        delete process.env.REACT_APP_AI_USE_LOCAL;

        try {
            jest.resetModules();
            const environment = require("./env").default;

            expect(environment.aiBaseUrl).toBe("https://api.example");
            expect(environment.aiUseLocalEngine).toBe(false);
        } finally {
            process.env.NODE_ENV = previousNodeEnv;
        }
    });

    it("turns AI off when the flag is set to false", () => {
        process.env.REACT_APP_AI_ENABLED = "false";
        process.env.REACT_APP_AI_USE_LOCAL = "true";

        jest.resetModules();
        const environment = require("./env").default;

        expect(environment.aiEnabled).toBe(false);
    });

    it("enables mutation proposal cards by default and supports rollback opt-out", () => {
        delete process.env.REACT_APP_AI_MUTATION_PROPOSALS_ENABLED;
        process.env.REACT_APP_AI_USE_LOCAL = "true";

        jest.resetModules();
        const defaultEnv = require("./env").default;
        expect(defaultEnv.aiMutationProposalsEnabled).toBe(true);

        process.env.REACT_APP_AI_MUTATION_PROPOSALS_ENABLED = "false";
        jest.resetModules();
        const disabledEnv = require("./env").default;
        expect(disabledEnv.aiMutationProposalsEnabled).toBe(false);
    });

    it("defaults the routed task-panel flag to false (opt-in) and only flips on for `true`", () => {
        // Phase 3 A2: the new routed inline task panel ships behind a
        // feature flag. Default false until validated; one-flag opt-in.
        const originalFlag = process.env.REACT_APP_TASK_PANEL_ROUTED;
        try {
            delete process.env.REACT_APP_TASK_PANEL_ROUTED;
            process.env.REACT_APP_AI_USE_LOCAL = "true";

            jest.resetModules();
            const defaultEnv = require("./env").default;
            expect(defaultEnv.taskPanelRouted).toBe(false);

            process.env.REACT_APP_TASK_PANEL_ROUTED = "false";
            jest.resetModules();
            const offEnv = require("./env").default;
            expect(offEnv.taskPanelRouted).toBe(false);

            process.env.REACT_APP_TASK_PANEL_ROUTED = "true";
            jest.resetModules();
            const onEnv = require("./env").default;
            expect(onEnv.taskPanelRouted).toBe(true);

            // Any value other than the literal "true" leaves the flag off.
            process.env.REACT_APP_TASK_PANEL_ROUTED = "TRUE";
            jest.resetModules();
            const otherEnv = require("./env").default;
            expect(otherEnv.taskPanelRouted).toBe(false);
        } finally {
            if (originalFlag === undefined) {
                delete process.env.REACT_APP_TASK_PANEL_ROUTED;
            } else {
                process.env.REACT_APP_TASK_PANEL_ROUTED = originalFlag;
            }
        }
    });

    it("defaults the CopilotDock flag to true (kill-switch) and only flips off for `false`", () => {
        // PRD-GAP-006: the tabbed CopilotDock is now the live AI surface,
        // so the flag defaults ON. Only the literal "false" rolls it back
        // (kill-switch); any other value — unset, "true", "TRUE", "1" —
        // leaves the dock enabled.
        const originalFlag = process.env.REACT_APP_COPILOT_DOCK_ENABLED;
        try {
            delete process.env.REACT_APP_COPILOT_DOCK_ENABLED;
            process.env.REACT_APP_AI_USE_LOCAL = "true";

            jest.resetModules();
            const defaultEnv = require("./env").default;
            expect(defaultEnv.copilotDockEnabled).toBe(true);

            process.env.REACT_APP_COPILOT_DOCK_ENABLED = "false";
            jest.resetModules();
            const offEnv = require("./env").default;
            expect(offEnv.copilotDockEnabled).toBe(false);

            process.env.REACT_APP_COPILOT_DOCK_ENABLED = "true";
            jest.resetModules();
            const onEnv = require("./env").default;
            expect(onEnv.copilotDockEnabled).toBe(true);

            // Any non-"false" value keeps the kill-switch open.
            process.env.REACT_APP_COPILOT_DOCK_ENABLED = "TRUE";
            jest.resetModules();
            const upperEnv = require("./env").default;
            expect(upperEnv.copilotDockEnabled).toBe(true);

            process.env.REACT_APP_COPILOT_DOCK_ENABLED = "1";
            jest.resetModules();
            const numericEnv = require("./env").default;
            expect(numericEnv.copilotDockEnabled).toBe(true);
        } finally {
            if (originalFlag === undefined) {
                delete process.env.REACT_APP_COPILOT_DOCK_ENABLED;
            } else {
                process.env.REACT_APP_COPILOT_DOCK_ENABLED = originalFlag;
            }
        }
    });

    it("uses the remote proxy when an AI base URL is provided", () => {
        process.env.REACT_APP_AI_BASE_URL = "https://copilot.example";

        jest.resetModules();
        const environment = require("./env").default;

        expect(environment.aiBaseUrl).toBe("https://copilot.example");
        expect(environment.aiUseLocalEngine).toBe(false);
    });

    // Fix 6 — URL validation tests
    describe("REACT_APP_AI_BASE_URL validation", () => {
        let consoleErrorSpy: jest.SpyInstance;

        beforeEach(() => {
            consoleErrorSpy = jest
                .spyOn(console, "error")
                .mockImplementation(() => {});
        });

        afterEach(() => {
            consoleErrorSpy.mockRestore();
        });

        it("passes through a valid https URL unchanged", () => {
            process.env.REACT_APP_AI_BASE_URL = "https://ai.example.com";
            jest.resetModules();
            const env = require("./env").default;
            expect(env.aiBaseUrl).toBe("https://ai.example.com");
            expect(env.aiUseLocalEngine).toBe(false);
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it("trims a trailing slash from a valid https URL", () => {
            process.env.REACT_APP_AI_BASE_URL = "https://ai.example.com/";
            jest.resetModules();
            const env = require("./env").default;
            expect(env.aiBaseUrl).toBe("https://ai.example.com");
        });

        it("preserves empty string without warning when local-engine flag is set", () => {
            process.env.REACT_APP_AI_BASE_URL = "";
            process.env.REACT_APP_AI_USE_LOCAL = "true";
            jest.resetModules();
            const env = require("./env").default;
            expect(env.aiBaseUrl).toBe("");
            expect(env.aiUseLocalEngine).toBe(true);
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it("accepts http: URL in non-production (dev) build", () => {
            // Jest NODE_ENV is "test" which is not "production", so isDevBuild
            // returns true and http: is accepted.
            process.env.REACT_APP_AI_BASE_URL = "http://localhost:8001";
            jest.resetModules();
            const env = require("./env").default;
            expect(env.aiBaseUrl).toBe("http://localhost:8001");
            expect(env.aiUseLocalEngine).toBe(false);
        });

        it("rejects a javascript: scheme and falls back to local engine", () => {
            process.env.REACT_APP_AI_BASE_URL = "javascript:alert(1)";
            jest.resetModules();
            const env = require("./env").default;
            expect(env.aiBaseUrl).toBe("");
            expect(env.aiUseLocalEngine).toBe(true);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining("unsupported scheme")
            );
        });

        it("rejects a malformed URL and falls back to local engine", () => {
            process.env.REACT_APP_AI_BASE_URL = "not-a-url";
            jest.resetModules();
            const env = require("./env").default;
            expect(env.aiBaseUrl).toBe("");
            expect(env.aiUseLocalEngine).toBe(true);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining("not a valid URL")
            );
        });

        it("rejects a file:// URL and falls back to local engine", () => {
            process.env.REACT_APP_AI_BASE_URL = "file:///etc/passwd";
            jest.resetModules();
            const env = require("./env").default;
            expect(env.aiBaseUrl).toBe("");
            expect(env.aiUseLocalEngine).toBe(true);
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        it("rejects a data: URL and falls back to local engine", () => {
            process.env.REACT_APP_AI_BASE_URL = "data:text/html,<h1>xss</h1>";
            jest.resetModules();
            const env = require("./env").default;
            expect(env.aiBaseUrl).toBe("");
            expect(env.aiUseLocalEngine).toBe(true);
            expect(consoleErrorSpy).toHaveBeenCalled();
        });
    });
});

export {};
