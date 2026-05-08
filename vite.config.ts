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
            chunkSizeWarningLimit: 1600
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
        plugins: [react(), svgr()]
    };
});
