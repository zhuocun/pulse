const assert = require("node:assert/strict");
const test = require("node:test");

const {
    SmokeError,
    buildConfig,
    messageContentFromEvent,
    parseSseFrame,
    productionHealthIssues,
    redact
} = require("./production-ai-smoke");

const SMOKE_ENV_KEYS = [
    "PULSE_BE_URL",
    "PULSE_BACKEND_URL",
    "BACKEND_URL",
    "REACT_APP_AI_BASE_URL",
    "REACT_APP_API_URL",
    "PULSE_SMOKE_EMAIL",
    "PULSE_SMOKE_PASSWORD",
    "PULSE_SMOKE_USERNAME",
    "PULSE_SMOKE_PROJECT_NAME",
    "PULSE_SMOKE_ORG",
    "PULSE_SMOKE_CLEANUP_PROJECT",
    "PULSE_SMOKE_ALLOW_REGISTER",
    "PULSE_SMOKE_ALLOW_STUB",
    "PULSE_SMOKE_ALLOW_NON_PRODUCTION",
    "PULSE_SMOKE_TIMEOUT_MS",
    "PULSE_SMOKE_STREAM_TIMEOUT_MS",
    "PULSE_SMOKE_THREAD_ID"
];

const withSmokeEnv = (values, fn) => {
    const previous = new Map();
    for (const key of SMOKE_ENV_KEYS) {
        previous.set(key, process.env[key]);
        delete process.env[key];
    }
    Object.assign(process.env, values);
    try {
        fn();
    } finally {
        for (const key of SMOKE_ENV_KEYS) {
            const value = previous.get(key);
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
};

test("buildConfig rejects generated users when registration is disabled", () => {
    withSmokeEnv(
        {
            PULSE_BE_URL: "https://pulse.example.test",
            PULSE_SMOKE_ALLOW_REGISTER: "false"
        },
        () => {
            assert.throws(
                () => buildConfig(),
                /requires PULSE_SMOKE_EMAIL and PULSE_SMOKE_PASSWORD/
            );
        }
    );
});

test("productionHealthIssues flags non-production readiness shape", () => {
    assert.deepEqual(
        productionHealthIssues({
            checkpointerBackend: "memory",
            storeBackend: "postgres",
            jwtSecretSource: "ephemeral",
            multiInstanceSafe: false,
            warnings: ["memory backend"]
        }),
        [
            "checkpointerBackend is not postgres",
            "jwtSecretSource is ephemeral",
            "multiInstanceSafe is false",
            "health warnings present: memory backend"
        ]
    );

    assert.deepEqual(
        productionHealthIssues({
            checkpointerBackend: "postgres",
            storeBackend: "postgres",
            jwtSecretSource: "env",
            multiInstanceSafe: true,
            warnings: []
        }),
        []
    );
});

test("SSE message parsing extracts only non-empty assistant text", () => {
    const parsed = parseSseFrame(
        'data: {"type":"messages","ns":[],"data":[{"content":"hello","type":"ai"},{}]}'
    );

    assert.equal(parsed.kind, "event");
    assert.equal(messageContentFromEvent(parsed.event), "hello");
    assert.equal(
        messageContentFromEvent({
            type: "updates",
            data: { status: "started" }
        }),
        ""
    );
});

test("SSE parser fails typed error frames", () => {
    assert.throws(
        () =>
            parseSseFrame(
                'data: {"type":"error","data":{"code":"agent_error","message":"nope"}}'
            ),
        /nope/
    );
});

test("redact removes token-like fields from nested failure details", () => {
    assert.deepEqual(
        redact({
            authorization: "Bearer secret-token",
            nested: { api_key: "sk-secret", ok: "visible" }
        }),
        {
            authorization: "[redacted]",
            nested: { api_key: "[redacted]", ok: "visible" }
        }
    );
    assert.ok(new SmokeError("x") instanceof Error);
});
