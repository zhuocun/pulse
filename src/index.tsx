import React from "react";
import ReactDOM from "react-dom/client";

import "antd/dist/reset.css";
import App from "./App";
import { setAnalyticsSink } from "./constants/analytics";
import environment from "./constants/env";
import reportWebVitals from "./reportWebVitals";
import { palette, paletteToCss } from "./theme/palettes";
import AppProviders from "./utils/appProviders";
import {
    devMemorySink,
    httpAnalyticsSink,
    httpErrorSink,
    setErrorSink
} from "./utils/observability/sinks";

/*
 * Inject palette-derived CSS custom properties synchronously, before
 * React's first render. Keeping this BEFORE `createRoot` means
 * styled-components see the runtime CSS vars from frame 1 — there's no
 * flash of an unstyled palette while React hydrates.
 *
 * The whole color identity flows from `./theme/palettes/index.ts`'s
 * active palette, so swapping palettes is a one-line edit there.
 */
const themeStyle = document.createElement("style");
themeStyle.id = `pulse-theme-vars-${palette.name}`;
themeStyle.textContent = paletteToCss(palette);
document.head.appendChild(themeStyle);

/*
 * Observability bootstrap — register production sinks when the env vars are
 * set, otherwise fall back to an in-memory dev sink (window.__copilotEvents__)
 * so QA can inspect events in the console without a real backend.
 *
 * Supported env vars (set in `.env.local` or at deploy time):
 *   VITE_ANALYTICS_ENDPOINT    — full URL for analytics POST batches
 *   VITE_ERROR_REPORT_ENDPOINT — full URL for error event POSTs
 *
 * We read from `process.env` (injected by Vite via `define` and available
 * in Jest) rather than `import.meta.env` to keep the file compatible with
 * the Jest/Babel test runner which does not support import.meta syntax.
 */
const analyticsEndpoint =
    (typeof process !== "undefined" && process.env?.VITE_ANALYTICS_ENDPOINT) ||
    "";

const errorEndpoint =
    (typeof process !== "undefined" &&
        process.env?.VITE_ERROR_REPORT_ENDPOINT) ||
    "";

if (analyticsEndpoint) {
    setAnalyticsSink(
        httpAnalyticsSink({
            endpoint: analyticsEndpoint,
            engineMode: environment.aiUseLocalEngine ? "local" : "remote"
        })
    );
} else if (process.env.NODE_ENV !== "production") {
    // DEV-only in-memory sink — inspect via window.__copilotEvents__.
    setAnalyticsSink(devMemorySink());
}

if (errorEndpoint) {
    setErrorSink(httpErrorSink({ endpoint: errorEndpoint }));
}

const root = ReactDOM.createRoot(
    document.getElementById("root") as HTMLElement
);
root.render(
    <React.StrictMode>
        <AppProviders>
            <App />
        </AppProviders>
    </React.StrictMode>
);

// In dev, log Core Web Vitals (LCP, INP, CLS, FCP, TTFB) to the console so
// regressions are visible during local testing. The dynamic import inside
// reportWebVitals() only fires when a callback is supplied, so production
// builds without an analytics beacon stay zero-cost.
reportWebVitals(
    // eslint-disable-next-line no-console
    process.env.NODE_ENV !== "production" ? console.log : undefined
);

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
}
