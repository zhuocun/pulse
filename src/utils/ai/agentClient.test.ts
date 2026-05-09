import {
    AgentAuthError,
    AgentBudgetError,
    AgentForbiddenError,
    AgentNotFoundError,
    AgentRateLimitError,
    AgentServerError,
    AgentTransportError,
    getAgentHealth,
    getAgentMetadata,
    invokeAgent,
    listAgents,
    streamAgent
} from "./agentClient";

const enc = new TextEncoder();

const sseChunk = (json: unknown) => `data: ${JSON.stringify(json)}\n\n`;

const makeHeaders = (entries: Record<string, string>) => {
    const map = new Map<string, string>(
        Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v])
    );
    return {
        get: (name: string) => map.get(name.toLowerCase()) ?? null,
        has: (name: string) => map.has(name.toLowerCase())
    };
};

/**
 * Stub the parts of the Fetch streaming API that `streamAgent` actually
 * touches: `response.body.getReader()` returning `{ read(): { value, done } }`
 * with Uint8Array chunks. jsdom does not ship a ReadableStream polyfill.
 */
const buildStreamResponse = (chunks: string[], status = 200) => {
    const queue = chunks.map((c) => enc.encode(c));
    let i = 0;
    const reader = {
        read: jest.fn(async () => {
            if (i >= queue.length) return { value: undefined, done: true };
            const value = queue[i];
            i += 1;
            return { value, done: false };
        }),
        releaseLock: jest.fn()
    };
    return {
        body: { getReader: () => reader },
        ok: status >= 200 && status < 300,
        status,
        headers: makeHeaders({ "Content-Type": "text/event-stream" })
    } as unknown as Response;
};

const okJsonResponse = (data: unknown) =>
    ({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(data),
        text: jest.fn().mockResolvedValue(JSON.stringify(data)),
        headers: makeHeaders({ "Content-Type": "application/json" })
    }) as unknown as Response;

const errorResponse = (
    status: number,
    body: unknown = {},
    extraHeaders: Record<string, string> = {}
) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return {
        ok: false,
        status,
        json: jest.fn().mockResolvedValue(typeof body === "string" ? {} : body),
        text: jest.fn().mockResolvedValue(text),
        headers: makeHeaders(extraHeaders)
    } as unknown as Response;
};

describe("agentClient", () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
        fetchSpy = jest.spyOn(global, "fetch");
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    const baseRequest = {
        baseUrl: "https://agents.example",
        name: "board-coach",
        body: {
            input: { messages: [{ role: "user", content: "hi" }] },
            config: {
                configurable: { thread_id: "t1", user_id: "u1" }
            },
            stream_mode: ["updates" as const, "messages" as const],
            version: "v2" as const
        }
    };

    describe("streamAgent", () => {
        it("yields parsed StreamParts in order", async () => {
            const chunks = [
                sseChunk({
                    type: "updates",
                    ns: ["root"],
                    data: { foo: "bar" }
                }),
                sseChunk({
                    type: "custom",
                    ns: ["root"],
                    data: {
                        kind: "citation",
                        refs: [{ source: "task", id: "t1", quote: "Fix login" }]
                    }
                }),
                ": keepalive\n\n",
                "event: ping\ndata: {}\n\n",
                sseChunk({
                    type: "messages",
                    ns: ["root"],
                    data: [{ content: "Hello" }, { langgraph_node: "agent" }]
                }),
                "data: [DONE]\n\n"
            ];
            fetchSpy.mockResolvedValueOnce(buildStreamResponse(chunks));

            const out = [];
            for await (const part of streamAgent(baseRequest)) {
                out.push(part);
            }

            expect(out.length).toBeGreaterThanOrEqual(3);
            // First chunk
            expect(out[0]).toMatchObject({ type: "updates" });
            // Citation custom
            expect(out[1]).toMatchObject({
                type: "custom",
                data: { kind: "citation" }
            });
            const last = out[out.length - 1];
            expect(last).toMatchObject({ type: "messages" });
            expect(fetchSpy).toHaveBeenCalledWith(
                "https://agents.example/api/v1/agents/board-coach/stream",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        Accept: "text/event-stream",
                        "Content-Type": "application/json"
                    })
                })
            );
        });

        it("maps a 401 to AgentAuthError", async () => {
            fetchSpy.mockResolvedValueOnce(
                errorResponse(401, { message: "no token" })
            );
            await expect(
                (async () => {
                    const out = [];
                    for await (const part of streamAgent(baseRequest)) {
                        out.push(part);
                    }
                    return out;
                })()
            ).rejects.toBeInstanceOf(AgentAuthError);
        });

        it("maps a 403 to AgentForbiddenError (not AgentAuthError)", async () => {
            fetchSpy.mockResolvedValueOnce(
                errorResponse(403, { message: "no autonomy" })
            );
            await expect(
                (async () => {
                    for await (const _ of streamAgent(baseRequest)) {
                        // exhaust
                    }
                })()
            ).rejects.toBeInstanceOf(AgentForbiddenError);
        });

        it("maps a 429 with Retry-After to AgentRateLimitError with seconds", async () => {
            fetchSpy.mockResolvedValueOnce(
                errorResponse(
                    429,
                    { message: "slow down" },
                    { "Retry-After": "5" }
                )
            );
            try {
                for await (const _ of streamAgent(baseRequest)) {
                    // exhaust
                }
                throw new Error("expected throw");
            } catch (err) {
                expect(err).toBeInstanceOf(AgentRateLimitError);
                expect((err as AgentRateLimitError).retryAfterSeconds).toBe(5);
            }
        });

        it("maps a 429 with X-Reason: budget to AgentBudgetError", async () => {
            fetchSpy.mockResolvedValueOnce(
                errorResponse(
                    429,
                    { message: "out of budget" },
                    { "X-Reason": "budget" }
                )
            );
            try {
                for await (const _ of streamAgent(baseRequest)) {
                    // exhaust
                }
                throw new Error("expected throw");
            } catch (err) {
                expect(err).toBeInstanceOf(AgentBudgetError);
            }
        });

        it("maps a 402 to AgentBudgetError", async () => {
            fetchSpy.mockResolvedValueOnce(
                errorResponse(402, { message: "payment required" })
            );
            try {
                for await (const _ of streamAgent(baseRequest)) {
                    // exhaust
                }
                throw new Error("expected throw");
            } catch (err) {
                expect(err).toBeInstanceOf(AgentBudgetError);
            }
        });

        it("maps a 404 to AgentNotFoundError", async () => {
            fetchSpy.mockResolvedValueOnce(errorResponse(404, "not found"));
            await expect(
                (async () => {
                    for await (const _ of streamAgent(baseRequest)) {
                        // exhaust
                    }
                })()
            ).rejects.toBeInstanceOf(AgentNotFoundError);
        });

        it("maps a 500 to AgentServerError with status", async () => {
            fetchSpy.mockResolvedValueOnce(errorResponse(503, "boom"));
            try {
                for await (const _ of streamAgent(baseRequest)) {
                    // exhaust
                }
                throw new Error("expected throw");
            } catch (err) {
                expect(err).toBeInstanceOf(AgentServerError);
                expect((err as AgentServerError).status).toBe(503);
            }
        });

        it("wraps a network failure as AgentTransportError", async () => {
            fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
            try {
                for await (const _ of streamAgent(baseRequest)) {
                    // exhaust
                }
                throw new Error("expected throw");
            } catch (err) {
                expect(err).toBeInstanceOf(AgentTransportError);
            }
        });

        it("respects an already-aborted signal before fetch", async () => {
            const ctrl = new AbortController();
            ctrl.abort();
            try {
                for await (const _ of streamAgent({
                    ...baseRequest,
                    signal: ctrl.signal
                })) {
                    // exhaust
                }
                throw new Error("expected throw");
            } catch (err) {
                expect((err as Error).name).toBe("AbortError");
                expect(fetchSpy).not.toHaveBeenCalled();
            }
        });

        it("surfaces an AbortError when fetch itself rejects with AbortError", async () => {
            fetchSpy.mockRejectedValueOnce(
                Object.assign(new Error("aborted"), { name: "AbortError" })
            );
            const ctrl = new AbortController();
            try {
                for await (const _ of streamAgent({
                    ...baseRequest,
                    signal: ctrl.signal
                })) {
                    // exhaust
                }
                throw new Error("expected throw");
            } catch (err) {
                expect((err as Error).name).toBe("AbortError");
            }
        });

        it("joins multi-line `data:` chunks into one StreamPart", async () => {
            // SSE allows the JSON payload to be split across several
            // `data:` lines; the parser must concatenate them on `\n`
            // before JSON.parse'ing. Encode an `updates` part across
            // four data lines.
            const chunks = [
                [
                    "data: {",
                    'data: "type": "updates",',
                    'data: "ns": ["root"],',
                    'data: "data": { "x": 1 }',
                    "data: }",
                    "",
                    ""
                ].join("\n")
            ];
            fetchSpy.mockResolvedValueOnce(buildStreamResponse(chunks));
            const out = [];
            for await (const part of streamAgent(baseRequest)) {
                out.push(part);
            }
            expect(out).toHaveLength(1);
            expect(out[0]).toEqual({
                type: "updates",
                ns: ["root"],
                data: { x: 1 }
            });
        });

        it("preserves trailing whitespace inside JSON string values (no .trim)", async () => {
            // SSE spec strips exactly one leading space after `data:`.
            // Trimming the whole line would clobber `"ok "` ⇒ `"ok"` and
            // change agent semantics. Encode a value with a trailing
            // space and assert it survives the round-trip.
            const payload = JSON.stringify({
                type: "messages",
                ns: ["root"],
                data: [{ content: "ok " }, {}]
            });
            const chunks = [`data: ${payload}\n\n`];
            fetchSpy.mockResolvedValueOnce(buildStreamResponse(chunks));
            const out = [];
            for await (const part of streamAgent(baseRequest)) {
                out.push(part);
            }
            expect(out).toHaveLength(1);
            const message = out[0] as {
                type: "messages";
                data: [{ content: string }, unknown];
            };
            expect(message.data[0].content).toBe("ok ");
        });

        it("throws AgentTransportError when an SSE data payload is not valid JSON", async () => {
            fetchSpy.mockResolvedValueOnce(
                buildStreamResponse(["data: not-json\n\n"])
            );
            try {
                for await (const _ of streamAgent(baseRequest)) {
                    // exhaust
                }
                throw new Error("expected throw");
            } catch (err) {
                expect(err).toBeInstanceOf(AgentTransportError);
                expect(err).toMatchObject({
                    name: "AgentTransportError",
                    code: "sse_invalid_json",
                    message: "Malformed agent stream event (invalid JSON)"
                });
            }
        });

        it("throws AgentTransportError when the final buffer holds invalid JSON without a closing blank line", async () => {
            fetchSpy.mockResolvedValueOnce(
                buildStreamResponse(["data: {oops"])
            );
            await expect(
                (async () => {
                    for await (const _ of streamAgent(baseRequest)) {
                        // exhaust
                    }
                })()
            ).rejects.toMatchObject({ code: "sse_invalid_json" });
        });

        it("wraps a mid-stream reader error as AgentTransportError", async () => {
            // Mock a reader that returns one good chunk then rejects on
            // the next read. The async generator should map that into a
            // typed AgentTransportError so the hook layer can surface a
            // user-visible error without re-parsing strings.
            const enc2 = new TextEncoder();
            let calls = 0;
            const reader = {
                read: jest.fn(async () => {
                    calls += 1;
                    if (calls === 1) {
                        return {
                            value: enc2.encode(
                                'data: {"type":"updates","ns":["root"],"data":{"step":1}}\n\n'
                            ),
                            done: false
                        };
                    }
                    throw new Error("network reset");
                }),
                releaseLock: jest.fn()
            };
            const response = {
                body: { getReader: () => reader },
                ok: true,
                status: 200,
                headers: makeHeaders({ "Content-Type": "text/event-stream" })
            } as unknown as Response;
            fetchSpy.mockResolvedValueOnce(response);

            const collected: unknown[] = [];
            await expect(
                (async () => {
                    for await (const part of streamAgent(baseRequest)) {
                        collected.push(part);
                    }
                })()
            ).rejects.toBeInstanceOf(AgentTransportError);
            // The first chunk should still have been yielded before the
            // error.
            expect(collected).toHaveLength(1);
        });
    });

    describe("invokeAgent", () => {
        it("returns the JSON body for a non-streaming call", async () => {
            fetchSpy.mockResolvedValueOnce(okJsonResponse({ ok: true }));
            const out = await invokeAgent({
                ...baseRequest
            });
            expect(out).toEqual({ ok: true });
            expect(fetchSpy).toHaveBeenCalledWith(
                "https://agents.example/api/v1/agents/board-coach/invoke",
                expect.objectContaining({ method: "POST" })
            );
        });
    });

    describe("listAgents", () => {
        it("returns the parsed agent list", async () => {
            fetchSpy.mockResolvedValueOnce(
                okJsonResponse({
                    agents: [
                        {
                            name: "board-coach",
                            version: "1.0.0",
                            description: "x",
                            status: "active",
                            allowed_autonomy: ["plan"]
                        }
                    ]
                })
            );
            const out = await listAgents({
                baseUrl: "https://agents.example"
            });
            expect(out.agents).toHaveLength(1);
            expect(out.agents[0].name).toBe("board-coach");
        });
    });

    describe("getAgentMetadata", () => {
        it("returns metadata for an agent by name", async () => {
            fetchSpy.mockResolvedValueOnce(
                okJsonResponse({
                    name: "board-coach",
                    version: "1.0.0",
                    description: "x",
                    status: "active",
                    allowed_autonomy: ["plan"]
                })
            );
            const out = await getAgentMetadata({
                baseUrl: "https://agents.example",
                name: "board-coach"
            });
            expect(out.name).toBe("board-coach");
            expect(fetchSpy).toHaveBeenCalledWith(
                "https://agents.example/api/v1/agents/board-coach",
                expect.objectContaining({ method: "GET" })
            );
        });
    });

    describe("getAgentHealth", () => {
        it("returns ok true and a latency number", async () => {
            fetchSpy.mockResolvedValueOnce(
                okJsonResponse({ ok: true, agentsLoaded: 3 })
            );
            const out = await getAgentHealth({
                baseUrl: "https://agents.example"
            });
            expect(out.ok).toBe(true);
            expect(out.agentsLoaded).toBe(3);
            expect(typeof out.latencyMs).toBe("number");
        });
    });

    // Fix 2 — Idempotency-Key header on agent requests.
    describe("Idempotency-Key header", () => {
        it("streamAgent sends an Idempotency-Key header", async () => {
            fetchSpy.mockResolvedValueOnce(
                buildStreamResponse([
                    sseChunk({
                        type: "messages",
                        ns: ["root"],
                        data: [{ content: "hi" }]
                    })
                ])
            );
            // Drain the async generator so fetch is actually called.
            const gen1 = streamAgent({ ...baseRequest });
            await gen1.next(); // consume at least one chunk
            const callHeaders = (
                fetchSpy.mock.calls[0][1] as {
                    headers?: Record<string, string>;
                }
            ).headers;
            expect(callHeaders?.["Idempotency-Key"]).toBeTruthy();
            expect(callHeaders?.["Idempotency-Key"]).toMatch(/-/);
        });

        it("invokeAgent sends an Idempotency-Key header", async () => {
            fetchSpy.mockResolvedValueOnce(
                okJsonResponse({ output: { result: "done" } })
            );
            await invokeAgent({ ...baseRequest });
            const callHeaders = (
                fetchSpy.mock.calls[0][1] as {
                    headers?: Record<string, string>;
                }
            ).headers;
            expect(callHeaders?.["Idempotency-Key"]).toBeTruthy();
            expect(callHeaders?.["Idempotency-Key"]).toMatch(/-/);
        });

        it("each streamAgent invocation generates a distinct key", async () => {
            fetchSpy
                .mockResolvedValueOnce(
                    buildStreamResponse([
                        sseChunk({
                            type: "messages",
                            ns: ["root"],
                            data: [{ content: "a" }]
                        })
                    ])
                )
                .mockResolvedValueOnce(
                    buildStreamResponse([
                        sseChunk({
                            type: "messages",
                            ns: ["root"],
                            data: [{ content: "b" }]
                        })
                    ])
                );
            // Drain each generator with .next() so fetch is called once per invocation.
            const genA = streamAgent({ ...baseRequest });
            await genA.next();
            const genB = streamAgent({ ...baseRequest });
            await genB.next();
            const key1 = (
                fetchSpy.mock.calls[0][1] as {
                    headers?: Record<string, string>;
                }
            ).headers?.["Idempotency-Key"];
            const key2 = (
                fetchSpy.mock.calls[1][1] as {
                    headers?: Record<string, string>;
                }
            ).headers?.["Idempotency-Key"];
            expect(key1).toBeTruthy();
            expect(key2).toBeTruthy();
            expect(key1).not.toBe(key2);
        });
    });
});
