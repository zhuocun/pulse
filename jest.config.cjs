/*
 * Benign-warning note (investigated 2026-05): jest occasionally logs
 * "A worker process has failed to exit gracefully ... tests leaking due
 * to improper teardown." There is NO leaked handle. At worker teardown
 * the only active libuv handles are the stdout/stderr sockets; the line
 * fires when V8/libuv teardown of the large multi-suite module graph
 * occasionally exceeds jest's hard-coded 500ms force-exit deadline under
 * CPU load. It never fails tests. The two usual suspects are both ruled
 * out: jsdom clears the MessageChannel polyfill's setTimeout on
 * window.close(), and reportWebVitals (the only dynamic import / observer
 * path) is mocked in every test. Do NOT add `--forceExit` or otherwise
 * suppress it — there is no real leak to fix, only a load-timing race.
 */
module.exports = {
    clearMocks: true,
    restoreMocks: true,
    collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
    moduleNameMapper: {
        // Path alias mirror of tsconfig `paths` / vite `resolve.alias` so
        // shadcn/ui components authored with `@/…` imports resolve in tests.
        "^@/(.*)$": "<rootDir>/src/$1",
        // Strip the ``.js`` suffix from relative TS imports so Jest can
        // resolve to the matching ``.ts`` file. Required because
        // ``api/index.ts`` imports ``./_proxy.js`` (mandatory under
        // Node ESM at runtime); without this Jest's CJS resolver
        // looks for a literal ``_proxy.js`` and fails.
        "^(\\.{1,2}/.*)\\.js$": "$1",
        "^@rc-component/picker/(.*)$":
            "<rootDir>/node_modules/@rc-component/picker/lib/$1",
        "^@rc-component/picker/locale/(.*)$":
            "<rootDir>/node_modules/@rc-component/picker/lib/locale/$1",
        "^react-router$":
            "<rootDir>/node_modules/react-router/dist/development/index.js",
        "^react-router-dom$":
            "<rootDir>/node_modules/react-router-dom/dist/index.js",
        "^react-router/dom$":
            "<rootDir>/node_modules/react-router/dist/development/dom-export.js",
        "\\.svg\\?react$": "<rootDir>/src/test/svgComponentMock.cjs",
        "\\.svg$": "<rootDir>/src/test/fileMock.cjs",
        "\\.(css|less|sass|scss)$": "<rootDir>/src/test/styleMock.cjs"
    },
    setupFilesAfterEnv: ["<rootDir>/src/setupTests.ts"],
    testPathIgnorePatterns: [
        "/node_modules/",
        "\\.cursor/skills/",
        "<rootDir>/scripts/production-ai-smoke.test.js"
    ],
    testEnvironment: "jsdom",
    testEnvironmentOptions: {
        url: "http://localhost/"
    },
    transform: {
        "^.+\\.(js|jsx|ts|tsx)$": "babel-jest"
    }
};
