import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    // Opt-in bundle-size report (ui-todo.md §2.C / §2.A.7 bundle budget).
    // Off by default so normal `vite build` is unaffected; run
    // `ANALYZE=true vite build` to emit dist/stats.html (gzip + treemap).
    const analyze = (env.ANALYZE ?? process.env.ANALYZE) === "true";
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
    const aiKnowledgeCutoff =
        env.REACT_APP_AI_KNOWLEDGE_CUTOFF ?? env.VITE_AI_KNOWLEDGE_CUTOFF ?? "";
    const bottomNavEnabled =
        env.REACT_APP_BOTTOM_NAV_ENABLED ?? env.VITE_BOTTOM_NAV_ENABLED ?? "";
    const taskPanelRouted =
        env.REACT_APP_TASK_PANEL_ROUTED ?? env.VITE_TASK_PANEL_ROUTED ?? "";
    const copilotDockEnabled =
        env.REACT_APP_COPILOT_DOCK_ENABLED ??
        env.VITE_COPILOT_DOCK_ENABLED ??
        "";
    const aiColumnReadinessEnabled =
        env.REACT_APP_AI_COLUMN_READINESS_ENABLED ??
        env.VITE_AI_COLUMN_READINESS_ENABLED ??
        "";
    const aiGhostTextEnabled =
        env.REACT_APP_AI_GHOST_TEXT_ENABLED ??
        env.VITE_AI_GHOST_TEXT_ENABLED ??
        "";
    const boardMinimapEnabled =
        env.REACT_APP_BOARD_MINIMAP_ENABLED ??
        env.VITE_BOARD_MINIMAP_ENABLED ??
        "";
    const activityFeedEnabled =
        env.REACT_APP_ACTIVITY_FEED_ENABLED ??
        env.VITE_ACTIVITY_FEED_ENABLED ??
        "";
    const analyticsEndpoint = env.VITE_ANALYTICS_ENDPOINT ?? "";
    const errorReportEndpoint = env.VITE_ERROR_REPORT_ENDPOINT ?? "";

    return {
        resolve: {
            alias: {
                "@": fileURLToPath(new URL("./src", import.meta.url))
            }
        },
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
                                name: "radix-vendor",
                                priority: 30,
                                test: /node_modules[\\/]@radix-ui[\\/]/
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
            "process.env.REACT_APP_AI_KNOWLEDGE_CUTOFF":
                JSON.stringify(aiKnowledgeCutoff),
            "process.env.REACT_APP_BOTTOM_NAV_ENABLED":
                JSON.stringify(bottomNavEnabled),
            "process.env.REACT_APP_TASK_PANEL_ROUTED":
                JSON.stringify(taskPanelRouted),
            "process.env.REACT_APP_COPILOT_DOCK_ENABLED":
                JSON.stringify(copilotDockEnabled),
            "process.env.REACT_APP_AI_COLUMN_READINESS_ENABLED": JSON.stringify(
                aiColumnReadinessEnabled
            ),
            "process.env.REACT_APP_AI_GHOST_TEXT_ENABLED":
                JSON.stringify(aiGhostTextEnabled),
            "process.env.REACT_APP_BOARD_MINIMAP_ENABLED":
                JSON.stringify(boardMinimapEnabled),
            "process.env.REACT_APP_ACTIVITY_FEED_ENABLED":
                JSON.stringify(activityFeedEnabled),
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
        plugins: [
            react(),
            svgr(),
            ...(analyze
                ? [
                      visualizer({
                          filename: "dist/stats.html",
                          gzipSize: true,
                          brotliSize: true,
                          template: "treemap"
                      })
                  ]
                : [])
        ]
    };
});
