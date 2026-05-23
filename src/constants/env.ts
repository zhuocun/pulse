/**
 * Environment configuration for the React app.
 *
 * Environment variables (all optional unless noted):
 *   REACT_APP_API_URL          — Origin of the REST API. Used only to
 *                                resolve `apiOrigin` (referenced by the
 *                                AI proxy default and a few cross-origin
 *                                hooks). REST calls always go through
 *                                the same-origin `/api/v1/*` prefix so
 *                                the HttpOnly session cookie set by
 *                                `/auth/login` rides automatically.
 *                                Default: Vercel deployment.
 *   REACT_APP_AI_BASE_URL      — Base URL for the AI proxy.
 *                                Must be a valid https: URL in production, or http: in dev.
 *                                Invalid URLs are rejected and local engine is forced.
 *   REACT_APP_AI_USE_LOCAL     — Set to "true" to force the local deterministic engine
 *                                even when REACT_APP_AI_BASE_URL is unset. When neither
 *                                REACT_APP_AI_BASE_URL nor REACT_APP_AI_USE_LOCAL is set,
 *                                deployed builds default aiBaseUrl to apiOrigin so they
 *                                reach the backend rather than running local-only.
 *                                Set this to "true" in .env.development and .env.test to
 *                                preserve the local-engine behavior in dev and CI.
 *   REACT_APP_AI_ENABLED       — Set to "false" to disable AI features entirely.
 *   REACT_APP_AI_KNOWLEDGE_CUTOFF — Human-readable knowledge-cutoff label shown in
 *                                `CopilotAboutPopover` (e.g. "January 2026").
 *                                Single ops-controlled source when the deployed
 *                                model changes; see also optional wire field
 *                                `AgentMetadata.knowledge_cutoff` (preferred when present).
 *   VITE_ANALYTICS_ENDPOINT    — Full URL for analytics event batches (POST).
 *   VITE_ERROR_REPORT_ENDPOINT — Full URL for error event reports (POST).
 */
const DEFAULT_API_ORIGIN = "https://pulse-python-server.vercel.app";

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
/**
 * REST calls live at a same-origin `/api/v1/*` prefix in both prod
 * (Vercel ``api/index.ts`` proxy function) and dev (Vite dev-
 * server proxy) so the HttpOnly session cookie issued by
 * ``POST /auth/login`` rides every request automatically. The previous
 * absolute `${apiOrigin}/api/v1` URL made REST cross-origin from the
 * FE, which on iOS 26.5 forced WebKit's ITP to silently drop the
 * JS-set cookie across a document teardown. An earlier same-origin
 * setup used a Vercel ``rewrites`` entry pointing at the BE; that
 * dropped the ``Set-Cookie`` / ``Cookie`` roundtrip in production
 * (login completed but every subsequent ``/api/v1/*`` call 401'd
 * across every browser, not just iOS) which is why we proxy through
 * an explicit Node function instead.
 */
const apiBaseUrl = "/api/v1";

/**
 * Resolve the AI base URL with the following precedence:
 *   1. REACT_APP_AI_BASE_URL set and non-empty → use it (validated below).
 *   2. REACT_APP_AI_USE_LOCAL === "true" → explicit local-engine opt-in → "".
 *   3. NODE_ENV === "test" → implicit local-engine in Jest; tests that need
 *      the remote path mock the `environment` module directly.
 *   4. Otherwise → default to apiOrigin so deployed builds reach the backend.
 */
const rawAiBaseUrl = readEnv("REACT_APP_AI_BASE_URL") ?? "";
const aiUseLocalFlag = readEnv("REACT_APP_AI_USE_LOCAL");
const isTestEnv =
    typeof process !== "undefined" && process.env?.NODE_ENV === "test";
const resolvedAiBaseUrlInput: string =
    rawAiBaseUrl.trim().length > 0
        ? rawAiBaseUrl
        : aiUseLocalFlag === "true" || isTestEnv
          ? ""
          : apiOrigin;

const aiBaseUrl = validateAiBaseUrl(resolvedAiBaseUrlInput);
const aiEnabledFlag = readEnv("REACT_APP_AI_ENABLED");
const aiMutationProposalsEnabledFlag = readEnv(
    "REACT_APP_AI_MUTATION_PROPOSALS_ENABLED"
);

const DEFAULT_AI_KNOWLEDGE_CUTOFF = "January 2026";
const aiKnowledgeCutoff =
    readEnv("REACT_APP_AI_KNOWLEDGE_CUTOFF")?.trim() ||
    DEFAULT_AI_KNOWLEDGE_CUTOFF;

/**
 * Phase 3 A3 — Bottom tab bar + demoted header. Default ON so the new
 * chassis is the live experience without a release toggle; set
 * `REACT_APP_BOTTOM_NAV_ENABLED=false` for a one-flag rollback to the
 * previous header-only chrome (the dropdown right-cluster comes back,
 * the bottom tab bar does not mount). When the env var is missing
 * entirely (production parity), the flag still defaults to true so
 * deployed builds get the new chassis.
 */
const bottomNavEnabledFlag = readEnv("REACT_APP_BOTTOM_NAV_ENABLED");

/**
 * Phase 3 A2 — Routed inline task panel. Opt-in until validated: the
 * new `<TaskDetailPanel>` route at `/projects/:projectId/board/task/:taskId`
 * only registers when this flag is "true". When the flag is unset or
 * "false" (default), the existing `<TaskModal>` overlay continues to
 * handle every task-open flow exactly as today, including all callsites
 * that go through `useTaskModal`. The migration plan is to flip the flag
 * once the panel is validated, then a second-pass PR migrates callsites
 * and removes the modal surface. Set `REACT_APP_TASK_PANEL_ROUTED=true`
 * in a local `.env.development` or at deploy time to enable.
 */
const taskPanelRoutedFlag = readEnv("REACT_APP_TASK_PANEL_ROUTED");

/**
 * Phase 3 A1 — CopilotDock. Opt-in until validated: when "true" the
 * board mounts a single tabbed `<CopilotDock>` hosting Chat + Brief
 * (plus future Inbox / Settings tabs) instead of the two legacy
 * `<AiChatDrawer>` / `<BoardBriefDrawer>` surfaces. When the flag is
 * unset or "false" (default) the legacy drawers continue to render
 * exactly as today and the dock does not mount. The migration plan
 * mirrors A2: one release with both surfaces alive behind the flag,
 * then a follow-up PR removes the legacy drawers. Set
 * `REACT_APP_COPILOT_DOCK_ENABLED=true` in a local `.env.development`
 * or at deploy time to enable.
 */
const copilotDockEnabledFlag = readEnv("REACT_APP_COPILOT_DOCK_ENABLED");

const environment = {
    apiBaseUrl,
    aiBaseUrl,
    aiEnabled: aiEnabledFlag === "false" ? false : true,
    aiUseLocalEngine: aiBaseUrl.length === 0,
    /**
     * Gates the MutationProposalCard surface. Defaults on now that the
     * backend emits organic `custom/mutation_proposal` events and the
     * accept/apply/undo lane is covered. Set
     * `REACT_APP_AI_MUTATION_PROPOSALS_ENABLED=false` for an operator rollback.
     */
    aiMutationProposalsEnabled:
        aiMutationProposalsEnabledFlag === "false" ? false : true,
    /** Override via `REACT_APP_AI_KNOWLEDGE_CUTOFF` (see file header). */
    aiKnowledgeCutoff,
    /**
     * Phase 3 A3 mobile-chassis flag. Default true so the new bottom
     * tab bar mounts on phones and the header demotes its right
     * cluster; set `REACT_APP_BOTTOM_NAV_ENABLED=false` to roll back.
     */
    bottomNavEnabled: bottomNavEnabledFlag === "false" ? false : true,
    /**
     * Phase 3 A2 routed-task-panel flag. Default false (opt-in) — see
     * the `taskPanelRoutedFlag` block above for the rollout plan.
     */
    taskPanelRouted: taskPanelRoutedFlag === "true",
    /**
     * Phase 3 A1 CopilotDock flag. Default false (opt-in) — see the
     * `copilotDockEnabledFlag` block above for the rollout plan.
     */
    copilotDockEnabled: copilotDockEnabledFlag === "true"
};

export default environment;
