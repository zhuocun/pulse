module.exports = {
    clearMocks: true,
    restoreMocks: true,
    collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
    moduleNameMapper: {
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
    testPathIgnorePatterns: ["/node_modules/", "\\.cursor/skills/"],
    testEnvironment: "jsdom",
    testEnvironmentOptions: {
        url: "http://localhost/"
    },
    transform: {
        "^.+\\.(js|jsx|ts|tsx)$": "babel-jest"
    }
};
