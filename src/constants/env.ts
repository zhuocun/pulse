/**
 * Environment configuration for the Jira React App.
 *
 * Environment variables (all optional unless noted):
 *   REACT_APP_API_URL          — Base URL for the REST API (default: Vercel deployment).
 *   REACT_APP_AI_BASE_URL      — Base URL for the AI proxy. Empty = local engine.
 *                                Must be a valid https: URL in production, or http: in dev.
 *                                Invalid URLs are rejected and local engine is forced.
 *   REACT_APP_AI_ENABLED       — Set to "false" to disable AI features entirely.
 *   VITE_ANALYTICS_ENDPOINT    — Full URL for analytics event batches (POST).
 *   VITE_ERROR_REPORT_ENDPOINT — Full URL for error event reports (POST).
 */
const DEFAULT_API_ORIGIN = "https://jira-python-server.vercel.app";

const readEnv = (key: string): string | undefined => {
    if (typeof process !== "undefined" && process.env && key in process.env) {
        return process.env[key];
    }
    return undefined;
};

/**
 * Detect whether the current build is a development build. Uses
 * `process.env.NODE_ENV` (set by Vite, CRA, and Jest) so the validation
 * logic works in both browser builds and Jest tests.
 */
const isDevBuild = (): boolean =>
    typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

/**
 * Validate and normalize the AI base URL.
 *
 * Rules:
 * - Empty string is valid (→ local engine, no warning).
 * - Trailing slashes are trimmed.
 * - `https:` is accepted in all environments.
 * - `http:` is accepted ONLY in DEV builds.
 * - All other schemes (`javascript:`, `file:`, `data:`, etc.) are rejected.
 * - Malformed URLs (fails `new URL()`) are rejected.
 * On rejection: logs a `console.error`, returns `""` (forces local engine).
 */
const validateAiBaseUrl = (raw: string): string => {
    if (!raw) return "";
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        // eslint-disable-next-line no-console
        console.error(
            `[env] REACT_APP_AI_BASE_URL is not a valid URL ("${trimmed}"). ` +
                "Falling back to local AI engine."
        );
        return "";
    }
    const protocol = parsed.protocol;
    if (protocol === "https:") return trimmed;
    if (protocol === "http:" && isDevBuild()) return trimmed;
    // eslint-disable-next-line no-console
    console.error(
        `[env] REACT_APP_AI_BASE_URL uses an unsupported scheme ("${protocol}"). ` +
            "Only https: (and http: in dev) are accepted. Falling back to local AI engine."
    );
    return "";
};

const apiOrigin = readEnv("REACT_APP_API_URL")?.trim() || DEFAULT_API_ORIGIN;
const apiBaseUrl = `${apiOrigin}/api/v1`;
const aiBaseUrl = validateAiBaseUrl(readEnv("REACT_APP_AI_BASE_URL") ?? "");
const aiEnabledFlag = readEnv("REACT_APP_AI_ENABLED");

const environment = {
    apiBaseUrl,
    aiBaseUrl,
    aiEnabled: aiEnabledFlag === "false" ? false : true,
    aiUseLocalEngine: aiBaseUrl.length === 0
};

export default environment;
