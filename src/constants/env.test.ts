/* eslint-disable global-require */
describe("environment", () => {
    const originalApiUrl = process.env.REACT_APP_API_URL;
    const originalAiBase = process.env.REACT_APP_AI_BASE_URL;
    const originalAiEnabled = process.env.REACT_APP_AI_ENABLED;
    const originalAiUseLocal = process.env.REACT_APP_AI_USE_LOCAL;

    afterEach(() => {
        jest.resetModules();
        process.env.REACT_APP_API_URL = originalApiUrl;
        process.env.REACT_APP_AI_BASE_URL = originalAiBase;
        process.env.REACT_APP_AI_ENABLED = originalAiEnabled;
        process.env.REACT_APP_AI_USE_LOCAL = originalAiUseLocal;
    });

    it("builds the API base URL from the React app API URL", () => {
        process.env.REACT_APP_API_URL = "https://jira-api.example";
        delete process.env.REACT_APP_AI_BASE_URL;
        delete process.env.REACT_APP_AI_ENABLED;
        process.env.REACT_APP_AI_USE_LOCAL = "true";

        jest.resetModules();
        const environment = require("./env").default;

        expect(environment.apiBaseUrl).toBe("https://jira-api.example/api/v1");
    });

    it("defaults the API origin when REACT_APP_API_URL is unset", () => {
        delete process.env.REACT_APP_API_URL;
        delete process.env.REACT_APP_AI_BASE_URL;
        delete process.env.REACT_APP_AI_ENABLED;
        process.env.REACT_APP_AI_USE_LOCAL = "true";

        jest.resetModules();
        const environment = require("./env").default;

        expect(environment.apiBaseUrl).toBe(
            "https://pulse-python-server.vercel.app/api/v1"
        );
    });

    it("reflects the environment value at module load time", () => {
        process.env.REACT_APP_API_URL = "http://localhost:8080";
        delete process.env.REACT_APP_AI_BASE_URL;
        delete process.env.REACT_APP_AI_ENABLED;
        process.env.REACT_APP_AI_USE_LOCAL = "true";

        jest.resetModules();
        const environment = require("./env").default;

        expect(environment.apiBaseUrl).toBe("http://localhost:8080/api/v1");
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
        process.env.REACT_APP_API_URL = "https://jira-api.example";
        delete process.env.REACT_APP_AI_BASE_URL;
        delete process.env.REACT_APP_AI_ENABLED;
        delete process.env.REACT_APP_AI_USE_LOCAL;

        try {
            jest.resetModules();
            const environment = require("./env").default;

            expect(environment.aiBaseUrl).toBe("https://jira-api.example");
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
