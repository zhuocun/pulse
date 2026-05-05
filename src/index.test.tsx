/* eslint-disable global-require */
import { render, screen } from "@testing-library/react";

// We cannot top-level import from "./index" because the module has side effects
// (ReactDOM.createRoot) that fire immediately on require. Instead, we grab the
// exported pure function via isolateModules after setting up necessary mocks.

type WarnFn = (
    analyticsEndpoint: string,
    errorEndpoint: string,
    isProd: boolean
) => void;

function loadWarnFn(): WarnFn {
    let fn!: WarnFn;
    // Mock ReactDOM so createRoot doesn't blow up in jsdom
    jest.doMock("react-dom/client", () => ({
        __esModule: true,
        default: { createRoot: jest.fn(() => ({ render: jest.fn() })) }
    }));
    jest.doMock("./reportWebVitals", () => ({
        __esModule: true,
        default: jest.fn()
    }));
    jest.isolateModules(() => {
        const mod = require("./index") as {
            warnIfMissingObservabilityEndpoints: WarnFn;
        };
        fn = mod.warnIfMissingObservabilityEndpoints;
    });
    jest.dontMock("react-dom/client");
    jest.dontMock("./reportWebVitals");
    return fn;
}

describe("warnIfMissingObservabilityEndpoints", () => {
    let warnIfMissing: WarnFn;
    let warnSpy: jest.SpyInstance;

    beforeAll(() => {
        document.body.innerHTML = '<div id="root"></div>';
        warnIfMissing = loadWarnFn();
    });

    beforeEach(() => {
        warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        // Reset the warnings array between tests
        (
            window as Window & { __copilotObservabilityWarnings__?: string[] }
        ).__copilotObservabilityWarnings__ = undefined as unknown as string[];
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it("emits one warn per missing endpoint in production", () => {
        warnIfMissing("", "", true);

        expect(warnSpy).toHaveBeenCalledTimes(2);
        expect(warnSpy.mock.calls[0][0]).toContain("VITE_ANALYTICS_ENDPOINT");
        expect(warnSpy.mock.calls[1][0]).toContain(
            "VITE_ERROR_REPORT_ENDPOINT"
        );
    });

    it("emits only the analytics warning when only analytics endpoint is missing in production", () => {
        warnIfMissing("", "https://errors.example.com", true);

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain("VITE_ANALYTICS_ENDPOINT");
    });

    it("emits only the error endpoint warning when only error endpoint is missing in production", () => {
        warnIfMissing("https://analytics.example.com", "", true);

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain(
            "VITE_ERROR_REPORT_ENDPOINT"
        );
    });

    it("emits no warnings when both endpoints are set in production", () => {
        warnIfMissing(
            "https://analytics.example.com",
            "https://errors.example.com",
            true
        );

        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("emits no warnings in development mode even when endpoints are missing", () => {
        warnIfMissing("", "", false);

        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("writes warnings to window.__copilotObservabilityWarnings__ in production", () => {
        warnIfMissing("", "", true);

        const recorded = (
            window as Window & { __copilotObservabilityWarnings__?: string[] }
        ).__copilotObservabilityWarnings__;

        expect(recorded).toHaveLength(2);
        expect(recorded![0]).toContain("VITE_ANALYTICS_ENDPOINT");
        expect(recorded![1]).toContain("VITE_ERROR_REPORT_ENDPOINT");
    });

    it("does not populate window.__copilotObservabilityWarnings__ in development", () => {
        warnIfMissing("", "", false);

        const recorded = (
            window as Window & { __copilotObservabilityWarnings__?: string[] }
        ).__copilotObservabilityWarnings__;

        expect(recorded == null || recorded.length === 0).toBe(true);
    });
});

describe("index entry", () => {
    beforeEach(() => {
        jest.resetModules();
        document.body.innerHTML = '<div id="root"></div>';
    });

    it("mounts App inside AppProviders and starts web vitals reporting", () => {
        const mockRender = jest.fn();
        const mockCreateRoot = jest.fn(() => ({ render: mockRender }));
        const mockReportWebVitals = jest.fn();

        jest.doMock("react-dom/client", () => ({
            __esModule: true,
            default: {
                createRoot: mockCreateRoot
            }
        }));
        jest.doMock("./App", () => {
            const React = require("react");

            return {
                __esModule: true,
                default: () =>
                    React.createElement("div", { "data-testid": "app" }, "App")
            };
        });
        jest.doMock("./utils/appProviders", () => {
            const React = require("react");

            return {
                __esModule: true,
                default: (props: { children: unknown }) =>
                    React.createElement(
                        "div",
                        { "data-testid": "app-providers" },
                        props.children
                    )
            };
        });
        jest.doMock("./reportWebVitals", () => ({
            __esModule: true,
            default: mockReportWebVitals
        }));

        jest.isolateModules(() => {
            require("./index");
        });

        expect(mockCreateRoot).toHaveBeenCalledWith(
            document.getElementById("root")
        );
        expect(mockRender).toHaveBeenCalledTimes(1);

        render(mockRender.mock.calls[0][0]);

        expect(screen.getByTestId("app-providers")).toContainElement(
            screen.getByTestId("app")
        );
        // In non-production environments we wire the metrics through
        // `console.log` so INP/LCP/CLS show up during local development. The
        // test runner sets NODE_ENV="test", which is not "production", so
        // a callback should be supplied.
        expect(mockReportWebVitals).toHaveBeenCalledWith(expect.any(Function));
    });
});
