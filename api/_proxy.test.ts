/**
 * @jest-environment node
 *
 * The proxy is a Node serverless function; it operates on real
 * ``IncomingMessage`` / ``ServerResponse`` instances and relies on
 * ``Headers.getSetCookie``, none of which are well-modelled by jsdom.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import {
    BACKEND_URL,
    REQUEST_HOP_HEADERS,
    RESPONSE_HOP_HEADERS,
    buildBackendTarget,
    buildOutgoingHeaders,
    buildOutgoingHeadersFromWeb,
    copyUpstreamHeaders,
    handleProxyFetch,
    handleProxyRequest,
    readRequestBody,
    writeUpstreamHeaders
} from "./_proxy";

type FakeRequest = Readable & {
    method: string;
    url: string;
    headers: Record<string, string | string[]>;
};

type FakeResponse = {
    statusCode: number;
    headersSent: boolean;
    setHeader: jest.Mock;
    end: jest.Mock;
};

const fakeReq = (init: {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[]>;
    body?: string;
}): FakeRequest => {
    const stream = init.body
        ? Readable.from([Buffer.from(init.body)])
        : Readable.from([]);
    return Object.assign(stream, {
        method: init.method ?? "GET",
        url: init.url ?? "/api/v1/users",
        headers: init.headers ?? {}
    }) as FakeRequest;
};

const fakeRes = (): FakeResponse => ({
    statusCode: 200,
    headersSent: false,
    setHeader: jest.fn(),
    end: jest.fn()
});

const upstreamResponse = (init: {
    status?: number;
    headers?: Record<string, string>;
    setCookies?: string[];
    body?: string;
}) => {
    const headers = new Headers(init.headers ?? {});
    for (const cookie of init.setCookies ?? []) {
        headers.append("Set-Cookie", cookie);
    }
    return {
        status: init.status ?? 200,
        headers,
        arrayBuffer: async () =>
            new TextEncoder().encode(init.body ?? "").buffer
    } as unknown as Response;
};

describe("api proxy header policy", () => {
    it("forwards application headers including Cookie", () => {
        const req = fakeReq({
            headers: {
                cookie: "Token=abc123",
                "user-agent": "agent/1.0",
                accept: "application/json"
            }
        });
        const headers = buildOutgoingHeaders(req as unknown as IncomingMessage);
        expect(headers.get("cookie")).toBe("Token=abc123");
        expect(headers.get("user-agent")).toBe("agent/1.0");
        expect(headers.get("accept")).toBe("application/json");
    });

    it("strips hop-by-hop request headers", () => {
        const req = fakeReq({
            headers: {
                host: "pulse-react-app.vercel.app",
                connection: "keep-alive",
                "content-length": "42",
                "x-vercel-id": "edge-1",
                cookie: "Token=x"
            }
        });
        const headers = buildOutgoingHeaders(req as unknown as IncomingMessage);
        for (const banned of REQUEST_HOP_HEADERS) {
            // The set covers a broader header list than this test
            // populates, but every header we DID pass that's in the
            // set must have been stripped.
            if (req.headers[banned] !== undefined) {
                expect(headers.get(banned)).toBeNull();
            }
        }
        // Application headers still pass through.
        expect(headers.get("cookie")).toBe("Token=x");
    });

    it("always asserts X-Forwarded-Proto: https", () => {
        // Override an incoming http value -- the BE's
        // ``_session_cookie_secure`` only sets ``Secure`` when this
        // says https, so we cannot let a stale dev header through.
        const req = fakeReq({ headers: { "x-forwarded-proto": "http" } });
        const headers = buildOutgoingHeaders(req as unknown as IncomingMessage);
        expect(headers.get("x-forwarded-proto")).toBe("https");
    });
});

describe("api proxy backend target normalization", () => {
    it("targets the backend's trailing-slash users route without relaying a 307", () => {
        expect(buildBackendTarget("/api/v1/users")).toBe(
            `${BACKEND_URL}/api/v1/users/`
        );
    });

    it("drops Vercel's rewrite path query while preserving real query params", () => {
        expect(
            buildBackendTarget(
                "/api/v1/projects?projectId=p1&path=v1%2Fprojects"
            )
        ).toBe(`${BACKEND_URL}/api/v1/projects/?projectId=p1`);
    });

    it("reconstructs the API path if Vercel exposes only the rewritten /api URL", () => {
        expect(buildBackendTarget("/api?path=v1%2Fusers")).toBe(
            `${BACKEND_URL}/api/v1/users/`
        );
    });

    it("keeps non-route path query params intact", () => {
        expect(buildBackendTarget("/api/v1/agents?path=v1%2Fprojects")).toBe(
            `${BACKEND_URL}/api/v1/agents?path=v1%2Fprojects`
        );
    });
});

describe("api proxy response header policy", () => {
    it("relays Set-Cookie response headers as a multi-value array", () => {
        const upstream = new Headers();
        upstream.append(
            "Set-Cookie",
            "Token=jwt-value; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400"
        );
        upstream.append("Set-Cookie", "other=val; Path=/");
        upstream.set("content-type", "application/json");
        const res = fakeRes();

        writeUpstreamHeaders(upstream, res as unknown as ServerResponse);

        // Set-Cookie must be forwarded as an array; a single string
        // would collapse the two cookies into one mis-parsed value.
        expect(res.setHeader).toHaveBeenCalledWith(
            "Set-Cookie",
            expect.arrayContaining([
                expect.stringContaining("Token=jwt-value"),
                expect.stringContaining("other=val")
            ])
        );
        expect(res.setHeader).toHaveBeenCalledWith(
            "content-type",
            "application/json"
        );
    });

    it("strips hop-by-hop response headers", () => {
        const upstream = new Headers();
        upstream.set("content-encoding", "gzip");
        upstream.set("connection", "keep-alive");
        upstream.set("content-type", "application/json");
        const res = fakeRes();

        writeUpstreamHeaders(upstream, res as unknown as ServerResponse);

        const seen = res.setHeader.mock.calls.map(([name]) =>
            String(name).toLowerCase()
        );
        for (const banned of RESPONSE_HOP_HEADERS) {
            expect(seen).not.toContain(banned);
        }
        expect(seen).toContain("content-type");
    });
});

describe("api proxy request lifecycle", () => {
    const mockFetch = jest.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
        mockFetch.mockReset();
        (global as { fetch: typeof fetch }).fetch =
            mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        (global as { fetch: typeof fetch }).fetch = originalFetch;
    });

    it("forwards GET requests to BACKEND_URL preserving the path", async () => {
        mockFetch.mockResolvedValue(upstreamResponse({ body: '{"ok":true}' }));
        const req = fakeReq({
            method: "GET",
            url: "/api/v1/projects?projectId=p1"
        });
        const res = fakeRes();

        await handleProxyRequest(
            req as unknown as IncomingMessage,
            res as unknown as ServerResponse
        );

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [target, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(target).toBe(`${BACKEND_URL}/api/v1/projects/?projectId=p1`);
        expect(init.method).toBe("GET");
        expect(init.body).toBeUndefined();
    });

    it("forwards POST bodies to the BE as a binary payload", async () => {
        mockFetch.mockResolvedValue(upstreamResponse({ body: "{}" }));
        const req = fakeReq({
            method: "POST",
            url: "/api/v1/auth/login",
            headers: { "content-type": "application/json" },
            body: '{"email":"a@b.c","password":"x"}'
        });
        const res = fakeRes();

        await handleProxyRequest(
            req as unknown as IncomingMessage,
            res as unknown as ServerResponse
        );

        const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(init.method).toBe("POST");
        expect(init.body).toBeInstanceOf(Uint8Array);
        expect(Buffer.from(init.body as Uint8Array).toString("utf-8")).toBe(
            '{"email":"a@b.c","password":"x"}'
        );
    });

    it("relays the upstream status code and body to the FE response", async () => {
        mockFetch.mockResolvedValue(
            upstreamResponse({
                status: 401,
                headers: { "content-type": "application/json" },
                body: '{"error":"empty JWT"}'
            })
        );
        const req = fakeReq({ url: "/api/v1/users" });
        const res = fakeRes();

        await handleProxyRequest(
            req as unknown as IncomingMessage,
            res as unknown as ServerResponse
        );

        expect(res.statusCode).toBe(401);
        const lastEnd = res.end.mock.calls.at(-1) as [Buffer];
        expect(Buffer.isBuffer(lastEnd[0])).toBe(true);
        expect(lastEnd[0].toString("utf-8")).toBe('{"error":"empty JWT"}');
    });

    it("falls back to 502 when the upstream fetch throws", async () => {
        mockFetch.mockRejectedValue(new Error("network down"));
        const req = fakeReq({ url: "/api/v1/users" });
        const res = fakeRes();
        // The proxy logs the underlying error before returning 502;
        // that log is part of the contract (operators see why the
        // proxy declined to relay) but it noisies the test output.
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        try {
            await handleProxyRequest(
                req as unknown as IncomingMessage,
                res as unknown as ServerResponse
            );

            expect(res.statusCode).toBe(502);
            expect(res.setHeader).toHaveBeenCalledWith(
                "content-type",
                "application/json"
            );
            const lastEnd = res.end.mock.calls.at(-1) as [string];
            expect(lastEnd[0]).toContain("Bad gateway");
            expect(errorSpy).toHaveBeenCalledWith(
                "[api proxy] forwarding error",
                expect.any(Error)
            );
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('requests redirect: "manual" so 30x stays on the proxy boundary', async () => {
        mockFetch.mockResolvedValue(upstreamResponse({ status: 204 }));
        const req = fakeReq({ url: "/api/v1/auth/logout", method: "POST" });
        const res = fakeRes();

        await handleProxyRequest(
            req as unknown as IncomingMessage,
            res as unknown as ServerResponse
        );

        const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(init.redirect).toBe("manual");
    });
});

describe("api proxy body extraction", () => {
    // The Vercel Node runtime drains the request stream before our
    // handler sees it, so we have to round-trip through ``req.body``;
    // these cases exercise the formats that Vercel hands us.

    const reqWithParsedBody = (parsed: unknown, method = "POST") =>
        Object.assign(Readable.from([]), {
            method,
            url: "/api/v1/auth/login",
            headers: { "content-type": "application/json" },
            body: parsed
        }) as unknown as IncomingMessage;

    it("re-serializes a parsed JSON object back to bytes", async () => {
        const req = reqWithParsedBody({
            email: "alice@example.com",
            password: "secret"
        });
        const body = await readRequestBody(req);
        expect(body).toBeInstanceOf(Uint8Array);
        const decoded = JSON.parse(Buffer.from(body!).toString("utf-8"));
        expect(decoded).toEqual({
            email: "alice@example.com",
            password: "secret"
        });
    });

    it("passes a string body through unchanged", async () => {
        const req = reqWithParsedBody("raw-text-payload");
        const body = await readRequestBody(req);
        expect(Buffer.from(body!).toString("utf-8")).toBe("raw-text-payload");
    });

    it("passes a Buffer body through unchanged", async () => {
        const buf = Buffer.from([1, 2, 3, 4]);
        const req = reqWithParsedBody(buf);
        const body = await readRequestBody(req);
        expect(Array.from(body!)).toEqual([1, 2, 3, 4]);
    });

    it("returns undefined for GET requests regardless of body", async () => {
        const req = reqWithParsedBody({ ignored: true }, "GET");
        expect(await readRequestBody(req)).toBeUndefined();
    });

    it("falls back to streaming when req.body is absent", async () => {
        const stream = Readable.from([Buffer.from("from-the-stream")]);
        const req = Object.assign(stream, {
            method: "POST",
            url: "/api/v1/auth/login",
            headers: { "content-type": "application/octet-stream" }
        }) as unknown as IncomingMessage;
        const body = await readRequestBody(req);
        expect(Buffer.from(body!).toString("utf-8")).toBe("from-the-stream");
    });
});

describe("api proxy BACKEND_URL env-var resolution", () => {
    // The module imports BACKEND_URL as a top-level const frozen at
    // import time, so a runtime ``process.env.BACKEND_URL`` mutation in
    // a regular ``it`` block would not retroactively re-evaluate the
    // proxy module. ``jest.isolateModules`` gives us a fresh module
    // registry per case so we can stub the env, re-require the proxy,
    // and observe the resolved constant.
    const originalBackendUrl = process.env.BACKEND_URL;

    afterEach(() => {
        if (originalBackendUrl === undefined) {
            delete process.env.BACKEND_URL;
        } else {
            process.env.BACKEND_URL = originalBackendUrl;
        }
    });

    it("buildBackendTarget routes to process.env.BACKEND_URL when set, falling back to the canonical pulse-python-server URL when empty", () => {
        const fallback = "https://pulse-python-server.vercel.app";

        // 1. BACKEND_URL explicitly set -- routing must follow it.
        jest.isolateModules(() => {
            process.env.BACKEND_URL = "https://my-be.example.com";
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require("./_proxy") as typeof import("./_proxy");
            expect(mod.BACKEND_URL).toBe("https://my-be.example.com");
            expect(mod.buildBackendTarget("/api/v1/users")).toBe(
                "https://my-be.example.com/api/v1/users/"
            );
        });

        // 2. BACKEND_URL empty / whitespace-only -- fallback.
        jest.isolateModules(() => {
            process.env.BACKEND_URL = "   ";
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require("./_proxy") as typeof import("./_proxy");
            expect(mod.BACKEND_URL).toBe(fallback);
            expect(mod.buildBackendTarget("/api/v1/users")).toBe(
                `${fallback}/api/v1/users/`
            );
        });

        // 3. BACKEND_URL unset -- same fallback.
        jest.isolateModules(() => {
            delete process.env.BACKEND_URL;
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require("./_proxy") as typeof import("./_proxy");
            expect(mod.BACKEND_URL).toBe(fallback);
            expect(mod.buildBackendTarget("/api/v1/agents")).toBe(
                `${fallback}/api/v1/agents`
            );
        });
    });
});

describe("api proxy fetch handler", () => {
    const originalFetch = global.fetch;
    let mockFetch: jest.Mock;

    beforeEach(() => {
        mockFetch = jest.fn();
        (global as { fetch: typeof fetch }).fetch = mockFetch;
    });

    afterEach(() => {
        (global as { fetch: typeof fetch }).fetch = originalFetch;
    });

    it("forwards POST JSON to the backend with the request path intact", async () => {
        mockFetch.mockResolvedValue(
            upstreamResponse({
                body: '{"_id":"u1"}',
                headers: { "content-type": "application/json" }
            })
        );
        const request = new Request(
            "https://pulse-react-app.vercel.app/api/v1/auth/login",
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    cookie: "Token=abc"
                },
                body: JSON.stringify({
                    email: "alice@example.com",
                    password: "secret"
                })
            }
        );

        const response = await handleProxyFetch(request);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [target, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(target).toBe(`${BACKEND_URL}/api/v1/auth/login`);
        expect(init.method).toBe("POST");
        expect(init.redirect).toBe("manual");
        expect(await new Response(init.body).text()).toBe(
            JSON.stringify({
                email: "alice@example.com",
                password: "secret"
            })
        );
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('{"_id":"u1"}');
    });

    it("copies multiple Set-Cookie headers without collapsing them", () => {
        const upstream = new Headers();
        upstream.append(
            "set-cookie",
            "Token=a; Path=/; HttpOnly; Secure; SameSite=Lax"
        );
        upstream.append(
            "set-cookie",
            "Other=b; Path=/; HttpOnly; Secure; SameSite=Lax"
        );
        const copied = copyUpstreamHeaders(upstream);
        expect(copied.getSetCookie()).toEqual([
            "Token=a; Path=/; HttpOnly; Secure; SameSite=Lax",
            "Other=b; Path=/; HttpOnly; Secure; SameSite=Lax"
        ]);
    });

    it("strips hop-by-hop request headers from the Web handler", () => {
        const incoming = new Headers({
            cookie: "Token=x",
            host: "pulse-react-app.vercel.app",
            "x-vercel-id": "edge-1"
        });
        const outgoing = buildOutgoingHeadersFromWeb(incoming);
        expect(outgoing.get("cookie")).toBe("Token=x");
        expect(outgoing.get("host")).toBeNull();
        expect(outgoing.get("x-vercel-id")).toBeNull();
        expect(outgoing.get("x-forwarded-proto")).toBe("https");
    });

    it("forwards path-only request.url values from Vercel rewrites", async () => {
        mockFetch.mockResolvedValue(
            upstreamResponse({
                status: 401,
                body: '{"error":"Invalid credentials"}'
            })
        );
        const request = {
            method: "POST",
            url: "/api/v1/auth/login",
            headers: new Headers({ "content-type": "application/json" }),
            arrayBuffer: async () =>
                new TextEncoder().encode(
                    JSON.stringify({
                        email: "probe@example.com",
                        password: "wrongpassword"
                    })
                ).buffer
        } as unknown as Request;

        const response = await handleProxyFetch(request);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [target] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(target).toBe(`${BACKEND_URL}/api/v1/auth/login`);
        expect(response.status).toBe(401);
    });
});
