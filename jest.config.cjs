module.exports = {
    clearMocks: true,
    restoreMocks: true,
    collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
    moduleNameMapper: {
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
    testEnvironment: "jsdom",
    testEnvironmentOptions: {
        url: "http://localhost/"
    },
    transform: {
        "^.+\\.(js|jsx|ts|tsx)$": "babel-jest"
    }
};
