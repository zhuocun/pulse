import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const apiUrl =
        env.REACT_APP_API_URL ||
        env.VITE_API_URL ||
        "https://pulse-python-server.vercel.app";
    const aiBaseUrl = env.REACT_APP_AI_BASE_URL ?? env.VITE_AI_BASE_URL ?? "";
    const aiEnabledRaw =
        env.REACT_APP_AI_ENABLED ?? env.VITE_AI_ENABLED ?? "true";
    const aiUseLocalRaw =
        env.REACT_APP_AI_USE_LOCAL ?? env.VITE_AI_USE_LOCAL ?? "";
    const aiMutationProposalsEnabledRaw =
        env.REACT_APP_AI_MUTATION_PROPOSALS_ENABLED ??
        env.VITE_AI_MUTATION_PROPOSALS_ENABLED ??
        "";
    const analyticsEndpoint = env.VITE_ANALYTICS_ENDPOINT ?? "";
    const errorReportEndpoint = env.VITE_ERROR_REPORT_ENDPOINT ?? "";

    return {
        build: {
            chunkSizeWarningLimit: 1000,
            rolldownOptions: {
                output: {
                    codeSplitting: {
                        groups: [
                            {
                                name: "react-vendor",
                                priority: 40,
                                test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/
                            },
                            {
                                maxSize: 600 * 1024,
                                name: "antd-vendor",
                                priority: 30,
                                test: /node_modules[\\/](antd|@ant-design|@rc-component|rc-)[\\/]/
                            },
                            {
                                name: "motion-vendor",
                                priority: 20,
                                test: /node_modules[\\/](framer-motion|motion-dom|motion-utils|tslib)[\\/]/
                            },
                            {
                                name: "app-vendor",
                                priority: 10,
                                test: /node_modules[\\/]/
                            }
                        ]
                    }
                }
            }
        },
        define: {
            "process.env.REACT_APP_API_URL": JSON.stringify(apiUrl),
            "process.env.REACT_APP_AI_BASE_URL": JSON.stringify(aiBaseUrl),
            "process.env.REACT_APP_AI_ENABLED": JSON.stringify(aiEnabledRaw),
            "process.env.REACT_APP_AI_USE_LOCAL": JSON.stringify(aiUseLocalRaw),
            "process.env.REACT_APP_AI_MUTATION_PROPOSALS_ENABLED":
                JSON.stringify(aiMutationProposalsEnabledRaw),
            "process.env.VITE_ANALYTICS_ENDPOINT":
                JSON.stringify(analyticsEndpoint),
            "process.env.VITE_ERROR_REPORT_ENDPOINT":
                JSON.stringify(errorReportEndpoint)
        },
        server: {
            // Mirror the prod ``api/index.ts`` Vercel function (the
            // FE same-origin proxy that the cookie handshake relies on)
            // in dev so the frontend and backend appear at one origin
            // in both environments. Without this the dev FE would hit
            // ``http://localhost:8000`` directly, cookies issued by
            // ``/auth/login`` would be third-party from the browser's
            // perspective, and iOS 26.5's ITP would silently drop
            // them -- defeating the whole point of the cookie move.
            proxy: {
                "/api": {
                    target: apiUrl,
                    changeOrigin: true,
                    // ``Set-Cookie`` rewrite: backend issues the
                    // cookie without a ``Domain`` so the browser
                    // scopes it to the proxy origin (localhost) --
                    // exactly what we want, no transformation needed.
                    secure: false
                }
            }
        },
        plugins: [react(), svgr()]
    };
});
