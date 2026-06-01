#!/usr/bin/env node

const crypto = require("crypto");

const SENSITIVE_KEY_RE =
    /(password|token|jwt|cookie|secret|authorization|api[_-]?key)/i;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_STREAM_TIMEOUT_MS = 90000;

class SmokeError extends Error {
    constructor(message, details) {
        super(message);
        this.name = "SmokeError";
        this.details = details;
    }
}

const env = process.env;

const usage = () => `Usage:
  PULSE_BE_URL=https://<backend-origin> npm run smoke:ai:prod

Required:
  PULSE_BE_URL, PULSE_BACKEND_URL, BACKEND_URL, REACT_APP_AI_BASE_URL, or REACT_APP_API_URL

Optional:
  PULSE_SMOKE_EMAIL
  PULSE_SMOKE_PASSWORD
  PULSE_SMOKE_USERNAME
  PULSE_SMOKE_PROJECT_NAME
  PULSE_SMOKE_ORG
  PULSE_SMOKE_CLEANUP_PROJECT=true
  PULSE_SMOKE_ALLOW_REGISTER=false
  PULSE_SMOKE_ALLOW_STUB=true
  PULSE_SMOKE_ALLOW_NON_PRODUCTION=true
  PULSE_SMOKE_TIMEOUT_MS=120000
  PULSE_SMOKE_STREAM_TIMEOUT_MS=90000`;

const getNonEmptyEnv = (...names) => {
    for (const name of names) {
        const value = env[name];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "";
};

const parseBooleanEnv = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
    throw new SmokeError(`${name} must be a boolean-like value`);
};

const parsePositiveIntEnv = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    if (!/^\d+$/.test(raw.trim())) {
        throw new SmokeError(`${name} must be a positive integer`);
    }
    const value = Number(raw.trim());
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new SmokeError(`${name} must be a positive integer`);
    }
    return value;
};

const normalizeBaseUrl = (raw) => {
    if (!raw) {
        throw new SmokeError(
            "Set PULSE_BE_URL to the backend origin before running the smoke"
        );
    }
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (cause) {
        throw new SmokeError("PULSE_BE_URL must be an absolute URL", {
            cause: cause.message
        });
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new SmokeError("PULSE_BE_URL must use http or https");
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
};

const randomHex = (bytes = 6) => crypto.randomBytes(bytes).toString("hex");

const normalizeUsername = (raw) => {
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
    return cleaned.length >= 3 ? cleaned : `smoke_${randomHex(5)}`;
};

const buildConfig = () => {
    const email = getNonEmptyEnv("PULSE_SMOKE_EMAIL");
    const password = getNonEmptyEnv("PULSE_SMOKE_PASSWORD");
    const allowRegister = parseBooleanEnv("PULSE_SMOKE_ALLOW_REGISTER", true);
    if ((email && !password) || (!email && password)) {
        throw new SmokeError(
            "Set both PULSE_SMOKE_EMAIL and PULSE_SMOKE_PASSWORD, or neither"
        );
    }
    if (!email && !allowRegister) {
        throw new SmokeError(
            "PULSE_SMOKE_ALLOW_REGISTER=false requires PULSE_SMOKE_EMAIL and PULSE_SMOKE_PASSWORD for an existing smoke account"
        );
    }

    const generatedSuffix = `${Date.now()}-${randomHex(4)}`;
    const generatedEmail = `pulse-smoke+${generatedSuffix}@example.com`;
    const usernameFromEmail = email
        ? normalizeUsername(email.split("@")[0])
        : "";
    const username =
        getNonEmptyEnv("PULSE_SMOKE_USERNAME") ||
        usernameFromEmail ||
        `smoke_${randomHex(5)}`;

    return {
        baseUrl: normalizeBaseUrl(
            getNonEmptyEnv(
                "PULSE_BE_URL",
                "PULSE_BACKEND_URL",
                "BACKEND_URL",
                "REACT_APP_AI_BASE_URL",
                "REACT_APP_API_URL"
            )
        ),
        email: email || generatedEmail,
        password: password || `PulseSmokePass-${randomHex(8)}-1`,
        username,
        usingGeneratedUser: !email,
        projectName:
            getNonEmptyEnv("PULSE_SMOKE_PROJECT_NAME") ||
            `Pulse AI Smoke ${generatedSuffix}`,
        organization: getNonEmptyEnv("PULSE_SMOKE_ORG") || "Pulse Smoke",
        cleanupProject: parseBooleanEnv("PULSE_SMOKE_CLEANUP_PROJECT", false),
        allowRegister,
        allowStub: parseBooleanEnv("PULSE_SMOKE_ALLOW_STUB", false),
        allowNonProduction: parseBooleanEnv(
            "PULSE_SMOKE_ALLOW_NON_PRODUCTION",
            false
        ),
        timeoutMs: parsePositiveIntEnv(
            "PULSE_SMOKE_TIMEOUT_MS",
            DEFAULT_TIMEOUT_MS
        ),
        streamTimeoutMs: parsePositiveIntEnv(
            "PULSE_SMOKE_STREAM_TIMEOUT_MS",
            DEFAULT_STREAM_TIMEOUT_MS
        ),
        threadId:
            getNonEmptyEnv("PULSE_SMOKE_THREAD_ID") ||
            `smoke-${Date.now()}-${randomHex(5)}`
    };
};

class CookieJar {
    constructor() {
        this.values = new Map();
    }

    store(headers) {
        const values =
            typeof headers.getSetCookie === "function"
                ? headers.getSetCookie()
                : [headers.get("set-cookie")].filter(Boolean);
        for (const header of values) {
            const first = String(header).split(";")[0];
            const index = first.indexOf("=");
            if (index <= 0) continue;
            this.values.set(
                first.slice(0, index).trim(),
                first.slice(index + 1)
            );
        }
    }

    header() {
        return Array.from(this.values.entries())
            .map(([key, value]) => `${key}=${value}`)
            .join("; ");
    }

    has(name) {
        return this.values.has(name);
    }
}

const redact = (value) => {
    if (Array.isArray(value)) return value.map(redact);
    if (typeof value === "string") {
        return value
            .replace(/(Bearer\s+)[^\s,;"]+/gi, "$1[redacted]")
            .replace(/(Token=)[^;\s,"]+/gi, "$1[redacted]")
            .replace(
                /("?(?:ai_)?jwt"?\s*[:=]\s*"?)[^"\s,;}]+/gi,
                "$1[redacted]"
            )
            .replace(
                /("?(?:password|secret|api[_-]?key)"?\s*[:=]\s*"?)[^"\s,;}]+/gi,
                "$1[redacted]"
            );
    }
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            out[key] = SENSITIVE_KEY_RE.test(key) ? "[redacted]" : redact(item);
        }
        return out;
    }
    return value;
};

const readResponseBody = async (response) => {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text.length > 500 ? `${text.slice(0, 500)}...` : text;
    }
};

const streamTimeoutError = (ms) =>
    new SmokeError(`chat-agent stream timed out after ${ms}ms`);
const httpTimeoutError = (method, path, ms) =>
    new SmokeError(`${method} ${path} timed out after ${ms}ms`);
const isAbortError = (cause) => cause && cause.name === "AbortError";

const request = async (config, path, options = {}) => {
    const controller = new AbortController();
    const method = options.method || "GET";
    const timeoutMs = options.timeoutMs || config.timeoutMs;
    const headers = new Headers(options.headers || {});
    if (options.json !== undefined) {
        headers.set("Content-Type", "application/json");
    }
    if (!headers.has("Accept")) {
        headers.set("Accept", "application/json");
    }
    const cookieHeader = options.cookieJar?.header();
    if (cookieHeader) headers.set("Cookie", cookieHeader);

    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${config.baseUrl}${path}`, {
            method,
            headers,
            body:
                options.json === undefined
                    ? undefined
                    : JSON.stringify(options.json),
            signal: controller.signal
        });
        options.cookieJar?.store(response.headers);

        const body = await readResponseBody(response);
        if (!response.ok) {
            throw new SmokeError(`${method} ${path} failed`, {
                status: response.status,
                body: redact(body)
            });
        }

        return { response, body };
    } catch (cause) {
        if (isAbortError(cause))
            throw httpTimeoutError(method, path, timeoutMs);
        throw cause;
    } finally {
        clearTimeout(timeout);
    }
};

const isRecord = (value) =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

const extractMessage = (body) => {
    if (!isRecord(body)) return "";
    const detail = body.detail;
    if (isRecord(detail)) {
        if (typeof detail.message === "string") return detail.message;
        if (
            isRecord(detail.error) &&
            typeof detail.error.message === "string"
        ) {
            return detail.error.message;
        }
    }
    if (isRecord(body.error) && typeof body.error.message === "string") {
        return body.error.message;
    }
    if (typeof body.message === "string") return body.message;
    return "";
};

const login = async (config, cookieJar) => {
    const { body } = await request(config, "/api/v1/auth/login", {
        method: "POST",
        cookieJar,
        json: { email: config.email, password: config.password }
    });
    if (!isRecord(body) || typeof body.ai_jwt !== "string" || !body.ai_jwt) {
        throw new SmokeError("Login response did not include ai_jwt", {
            body: redact(body)
        });
    }
    if (!cookieJar.has("Token")) {
        throw new SmokeError("Login did not set the REST session cookie");
    }
    return body.ai_jwt;
};

const register = async (config) => {
    await request(config, "/api/v1/auth/register", {
        method: "POST",
        json: {
            username: config.username,
            email: config.email,
            password: config.password
        }
    });
};

const authenticate = async (config, cookieJar) => {
    if (config.usingGeneratedUser) {
        await register(config);
        return login(config, cookieJar);
    }

    try {
        return await login(config, cookieJar);
    } catch (cause) {
        if (!config.allowRegister) throw cause;
        const status =
            cause instanceof SmokeError ? cause.details?.status : undefined;
        if (status !== 401) throw cause;
        await register(config);
        return login(config, cookieJar);
    }
};

const refreshAiToken = async (config, cookieJar) => {
    const { body } = await request(config, "/api/v1/auth/ai-token", {
        method: "POST",
        cookieJar
    });
    if (!isRecord(body) || typeof body.ai_jwt !== "string" || !body.ai_jwt) {
        throw new SmokeError(
            "AI token refresh response did not include ai_jwt",
            {
                body: redact(body)
            }
        );
    }
    return body.ai_jwt;
};

const authHeaders = (aiToken) => ({
    Authorization: `Bearer ${aiToken}`
});

const productionHealthIssues = (body) => {
    const issues = [];
    if (body.checkpointerBackend !== "postgres") {
        issues.push("checkpointerBackend is not postgres");
    }
    if (body.storeBackend !== "postgres") {
        issues.push("storeBackend is not postgres");
    }
    if (body.jwtSecretSource === "ephemeral") {
        issues.push("jwtSecretSource is ephemeral");
    }
    if (body.multiInstanceSafe === false) {
        issues.push("multiInstanceSafe is false");
    }
    const warnings = Array.isArray(body.warnings)
        ? body.warnings.filter((warning) => String(warning).trim())
        : [];
    if (warnings.length) {
        issues.push(`health warnings present: ${warnings.join("; ")}`);
    }
    return issues;
};

const checkHealth = async (config) => {
    const { body } = await request(config, "/api/v1/health/ai?probe=true");
    if (!isRecord(body)) {
        throw new SmokeError("AI health response was not a JSON object");
    }
    if (body.ready !== true) {
        throw new SmokeError("AI health is not ready", { body: redact(body) });
    }
    if (body.realProviderReady !== true && !config.allowStub) {
        throw new SmokeError(
            "AI health reports realProviderReady=false; set PULSE_SMOKE_ALLOW_STUB=true only for non-production checks",
            { body: redact(body) }
        );
    }
    const connectivity = body.providerConnectivity;
    if (!isRecord(connectivity) || connectivity.reachable !== true) {
        throw new SmokeError("AI provider connectivity probe failed", {
            body: redact(body)
        });
    }
    if (body.stubMode === true && !config.allowStub) {
        throw new SmokeError(
            "AI health reports stubMode=true; set PULSE_SMOKE_ALLOW_STUB=true only for non-production checks",
            { provider: body.provider }
        );
    }
    if (!config.allowNonProduction) {
        const productionIssues = productionHealthIssues(body);
        if (productionIssues.length) {
            throw new SmokeError(
                "AI health is not production-shaped; set PULSE_SMOKE_ALLOW_NON_PRODUCTION=true only for non-production or small-group checks",
                { issues: productionIssues, body: redact(body) }
            );
        }
    }
    return body;
};

const listAgents = async (config, aiToken) => {
    const { body } = await request(config, "/api/v1/agents", {
        headers: authHeaders(aiToken)
    });
    if (!isRecord(body) || !Array.isArray(body.agents)) {
        throw new SmokeError("Agent list response did not include agents[]", {
            body: redact(body)
        });
    }
    const chatAgent = body.agents.find(
        (agent) => isRecord(agent) && agent.name === "chat-agent"
    );
    if (!chatAgent) {
        throw new SmokeError("GET /api/v1/agents did not include chat-agent");
    }
    return { agents: body.agents, chatAgent };
};

const listProjectsByName = async (config, cookieJar) => {
    const path = `/api/v1/projects?projectName=${encodeURIComponent(
        config.projectName
    )}`;
    const { body } = await request(config, path, { cookieJar });
    if (Array.isArray(body)) return body.filter(isRecord);
    if (isRecord(body)) return [body];
    throw new SmokeError("Project lookup response had an unexpected shape", {
        body: redact(body)
    });
};

const createOrFindProject = async (config, cookieJar) => {
    const existing = await listProjectsByName(config, cookieJar);
    const exact = existing.find(
        (project) =>
            project.projectName === config.projectName &&
            (!config.organization ||
                project.organization === config.organization)
    );
    if (exact && typeof exact._id === "string" && exact._id) {
        return { projectId: exact._id, created: false };
    }

    await request(config, "/api/v1/projects", {
        method: "POST",
        cookieJar,
        json: {
            projectName: config.projectName,
            organization: config.organization
        }
    });

    const afterCreate = await listProjectsByName(config, cookieJar);
    const created = afterCreate.find(
        (project) =>
            project.projectName === config.projectName &&
            project.organization === config.organization &&
            typeof project._id === "string" &&
            project._id
    );
    if (!created) {
        throw new SmokeError("Created project could not be found by name");
    }
    return { projectId: created._id, created: true };
};

const deleteProject = async (config, cookieJar, projectId) => {
    await request(
        config,
        `/api/v1/projects?projectId=${encodeURIComponent(projectId)}`,
        {
            method: "DELETE",
            cookieJar
        }
    );
};

const parseSseFrame = (frame) => {
    const lines = frame.split(/\n/);
    const data = [];
    for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (!line || line.startsWith(":") || line.startsWith("event:"))
            continue;
        if (line.startsWith("data: ")) data.push(line.slice(6));
        else if (line.startsWith("data:")) data.push(line.slice(5));
    }
    if (data.length === 0) return { kind: "empty" };
    const payload = data.join("\n");
    if (payload.trim() === "[DONE]") return { kind: "done" };
    let parsed;
    try {
        parsed = JSON.parse(payload);
    } catch (cause) {
        throw new SmokeError("Agent stream emitted malformed JSON", {
            cause: cause.message,
            payload: payload.slice(0, 500)
        });
    }
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
        throw new SmokeError("Agent stream emitted an invalid event envelope", {
            event: redact(parsed)
        });
    }
    if (parsed.type === "error") {
        const message =
            isRecord(parsed.data) && typeof parsed.data.message === "string"
                ? parsed.data.message
                : "Agent stream returned an error frame";
        throw new SmokeError(message, {
            code: isRecord(parsed.data) ? parsed.data.code : undefined,
            event: redact(parsed)
        });
    }
    if (
        parsed.type === "custom" &&
        isRecord(parsed.data) &&
        parsed.data.kind === "error"
    ) {
        throw new SmokeError("Agent stream returned a custom error frame", {
            event: redact(parsed)
        });
    }
    const validTypes = new Set(["updates", "messages", "custom", "interrupt"]);
    if (!validTypes.has(parsed.type)) {
        throw new SmokeError("Agent stream emitted an unknown event type", {
            event: redact(parsed)
        });
    }
    return { kind: "event", event: parsed };
};

const messageContentFromEvent = (event) => {
    if (!isRecord(event) || event.type !== "messages") return "";
    const data = event.data;
    if (!Array.isArray(data) || !isRecord(data[0])) return "";
    const content = data[0].content;
    return typeof content === "string" ? content : "";
};

const smokeChatStream = async (config, aiToken, projectId) => {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        config.streamTimeoutMs
    );
    let response;
    try {
        response = await fetch(
            `${config.baseUrl}/api/v1/agents/chat-agent/stream`,
            {
                method: "POST",
                headers: {
                    ...authHeaders(aiToken),
                    Accept: "text/event-stream",
                    "Content-Type": "application/json",
                    "Idempotency-Key": `smoke-${crypto.randomUUID()}`
                },
                body: JSON.stringify({
                    input: {
                        messages: [
                            {
                                role: "user",
                                content:
                                    "Reply with one short sentence confirming the production AI smoke check is running."
                            }
                        ],
                        project_id: projectId
                    },
                    config: {
                        configurable: {
                            thread_id: config.threadId,
                            project_id: projectId
                        }
                    },
                    stream_mode: ["updates", "messages", "custom"],
                    version: "v2"
                }),
                signal: controller.signal
            }
        );
    } catch (cause) {
        clearTimeout(timeout);
        if (isAbortError(cause))
            throw streamTimeoutError(config.streamTimeoutMs);
        throw cause;
    }

    if (!response.ok) {
        let body;
        try {
            body = await readResponseBody(response);
        } catch (cause) {
            clearTimeout(timeout);
            if (isAbortError(cause))
                throw streamTimeoutError(config.streamTimeoutMs);
            throw cause;
        }
        clearTimeout(timeout);
        throw new SmokeError("chat-agent stream request failed", {
            status: response.status,
            message: extractMessage(body),
            body: redact(body)
        });
    }

    const reader = response.body?.getReader();
    if (!reader) {
        clearTimeout(timeout);
        throw new SmokeError("chat-agent stream response had no readable body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let validEvents = 0;
    let doneSeen = false;
    let messageText = "";
    const eventTypes = new Set();

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder
                .decode(value, { stream: true })
                .replace(/\r\n/g, "\n");
            let separator = buffer.indexOf("\n\n");
            while (separator >= 0) {
                const frame = buffer.slice(0, separator);
                buffer = buffer.slice(separator + 2);
                const parsed = parseSseFrame(frame);
                if (parsed.kind === "done") doneSeen = true;
                if (parsed.kind === "event") {
                    validEvents += 1;
                    eventTypes.add(parsed.event.type);
                    messageText += messageContentFromEvent(parsed.event);
                }
                separator = buffer.indexOf("\n\n");
            }
        }
        const tail = buffer.trim();
        if (tail) {
            const parsed = parseSseFrame(tail);
            if (parsed.kind === "done") doneSeen = true;
            if (parsed.kind === "event") {
                validEvents += 1;
                eventTypes.add(parsed.event.type);
                messageText += messageContentFromEvent(parsed.event);
            }
        }
    } catch (cause) {
        if (isAbortError(cause))
            throw streamTimeoutError(config.streamTimeoutMs);
        throw cause;
    } finally {
        clearTimeout(timeout);
        try {
            reader.releaseLock();
        } catch {}
    }

    if (!doneSeen) {
        throw new SmokeError("chat-agent stream completed without DONE");
    }
    if (validEvents === 0) {
        throw new SmokeError("chat-agent stream completed without SSE events");
    }
    if (!messageText.trim()) {
        throw new SmokeError(
            "chat-agent stream completed without a non-empty message event"
        );
    }

    return {
        validEvents,
        doneSeen,
        eventTypes: Array.from(eventTypes).sort()
    };
};

const logStep = (message) => {
    process.stdout.write(`- ${message}\n`);
};

const main = async () => {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        process.stdout.write(`${usage()}\n`);
        return;
    }

    const config = buildConfig();
    const cookieJar = new CookieJar();
    let cleanupProjectId = "";
    let cleanupFailure = null;

    try {
        logStep(`Checking AI readiness at ${config.baseUrl}`);
        const health = await checkHealth(config);
        logStep(
            `AI health ready: provider=${health.provider}, model=${health.model}, realProviderReady=${health.realProviderReady}, checkpointer=${health.checkpointerBackend}, store=${health.storeBackend}`
        );

        logStep("Authenticating smoke user");
        await authenticate(config, cookieJar);
        const aiToken = await refreshAiToken(config, cookieJar);
        logStep("AI proxy token available");

        logStep("Listing registered agents");
        const { agents, chatAgent } = await listAgents(config, aiToken);
        logStep(
            `Registered agents: ${agents.length}; chat-agent status=${chatAgent.status}`
        );

        logStep("Creating or finding smoke project");
        const project = await createOrFindProject(config, cookieJar);
        if (project.created && config.cleanupProject)
            cleanupProjectId = project.projectId;
        logStep(
            `${project.created ? "Created" : "Found"} project for gated smoke run`
        );

        logStep("Opening authenticated chat-agent stream");
        const stream = await smokeChatStream(
            config,
            aiToken,
            project.projectId
        );
        logStep(
            `chat-agent stream ok: events=${stream.validEvents}, done=${stream.doneSeen}, types=${stream.eventTypes.join(",") || "none"}`
        );
    } finally {
        if (cleanupProjectId) {
            try {
                await deleteProject(config, cookieJar, cleanupProjectId);
                logStep("Cleaned up smoke project");
            } catch (cause) {
                cleanupFailure = cause;
            }
        }
    }

    if (cleanupFailure) {
        throw new SmokeError("Smoke passed, but project cleanup failed", {
            message: cleanupFailure.message,
            details: redact(cleanupFailure.details)
        });
    }

    process.stdout.write("Production AI smoke passed\n");
};

if (require.main === module) {
    main().catch((cause) => {
        const message =
            cause instanceof Error
                ? cause.message
                : "Production AI smoke failed";
        process.stderr.write(`Production AI smoke failed: ${message}\n`);
        if (cause instanceof SmokeError && cause.details !== undefined) {
            process.stderr.write(
                `${JSON.stringify(redact(cause.details), null, 2)}\n`
            );
        }
        process.exitCode = 1;
    });
}

// prettier-ignore
module.exports = { SmokeError, buildConfig, messageContentFromEvent, parseSseFrame, productionHealthIssues, redact };
