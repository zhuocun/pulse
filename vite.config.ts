import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const apiUrl =
        env.REACT_APP_API_URL ||
        env.VITE_API_URL ||
        "https://jira-python-server.vercel.app";
    const aiBaseUrl = env.REACT_APP_AI_BASE_URL ?? env.VITE_AI_BASE_URL ?? "";
    const aiEnabledRaw =
        env.REACT_APP_AI_ENABLED ?? env.VITE_AI_ENABLED ?? "true";

    return {
        build: {
            chunkSizeWarningLimit: 1600
        },
        define: {
            "process.env.REACT_APP_API_URL": JSON.stringify(apiUrl),
            "process.env.REACT_APP_AI_BASE_URL": JSON.stringify(aiBaseUrl),
            "process.env.REACT_APP_AI_ENABLED": JSON.stringify(aiEnabledRaw)
        },
        plugins: [react(), svgr()]
    };
});
