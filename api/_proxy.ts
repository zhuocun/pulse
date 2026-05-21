/**
 * Same-origin proxy from the FE Vercel project to the Python BE.
 *
 * Replaces an earlier ``vercel.json`` external rewrite (``/api/:path*``
 * -> ``https://pulse-python-server.vercel.app/api/:path*``). The rewrite
 * silently dropped the session cookie roundtrip in production: the FE
 * saw ``POST /auth/login`` succeed (the response body populates the
 * user cache, so the SPA navigated to ``/projects``) but the next
 * same-origin fetch sent no ``Cookie`` header, every subsequent call
 * 401'd, and a manual refresh bounced back to ``/login``. Reproduced
 * on iOS Safari, Android Chrome, and desktop Chrome -- not the
 * iOS-only ITP issue the cookie move was meant to dodge.
 *
 * The explicit function below removes the unknown by copying every
 * request header on the way out (notably ``Cookie``) and every
 * response header on the way back (notably ``Set-Cookie``). The
 * browser only ever sees the same-origin FE URL, so the cookie binds
 * to the FE host and rides on every subsequent ``/api/v1/*`` call.
 *
 * Vite's dev server proxy (see ``vite.config.ts``) plays the same role
 * locally, so the FE codebase can keep calling the relative
 * ``/api/v1/...`` prefix unconditionally.
 *
 * The underscore prefix excludes this file from Vercel's serverless
 * function discovery -- only ``api/index.ts`` is exposed as an
 * endpoint; this file ships as a bundled dependency.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const BACKEND_URL = "https://pulse-python-server.vercel.app";

// Request headers a forwarder must NOT pass through. ``host`` belongs
// to the FE edge; ``content-length`` is recomputed from the body that
// fetch() sees; the ``x-vercel-*`` family is Vercel's internal routing
// metadata and must not leak to the upstream.
export const REQUEST_HOP_HEADERS = new Set([
    "connection",
    "keep-alive",
    "host",
    "content-length",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "proxy-authorization",
    "proxy-authenticate",
    "x-vercel-id",
    "x-vercel-deployment-url",
    "x-vercel-forwarded-for",
    "x-vercel-internal-host",
    "x-vercel-ip-country",
    "x-vercel-ip-country-region",
    "x-vercel-ip-city",
    "x-vercel-ip-timezone"
]);

// Response headers a forwarder must NOT pass back. ``content-encoding``
// is gone because undici's fetch() decompressed the body before we
// read it; ``content-length`` is recomputed by Node when we
// ``res.end()`` the new buffer.
export const RESPONSE_HOP_HEADERS = new Set([
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "proxy-authorization",
    "proxy-authenticate",
    "content-encoding",
    "content-length"
]);

export const readRequestBody = async (
    req: IncomingMessage
): Promise<Uint8Array | undefined> => {
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") return undefined;

    // Vercel's Node runtime auto-parses JSON / form bodies on
    // ingress and exposes the result as ``req.body`` -- the
    // underlying stream is already drained by the time the handler
    // runs, so reading it would silently give us nothing and the
    // BE would see a body-less POST (400 validation errors that
    // the FE surfaces as the generic "Operation failed"). Prefer
    // ``req.body`` when present and re-serialize it back to bytes
    // so the BE deserializes the exact same shape; fall back to
    // streaming for cases where the runtime did not pre-parse
    // (raw binary uploads, future content types we add).
    const parsedBody = (req as IncomingMessage & { body?: unknown }).body;
    if (parsedBody !== undefined && parsedBody !== null) {
        if (typeof parsedBody === "string") {
            return new Uint8Array(Buffer.from(parsedBody));
        }
        if (Buffer.isBuffer(parsedBody)) {
            return new Uint8Array(parsedBody);
        }
        if (parsedBody instanceof Uint8Array) {
            return parsedBody;
        }
        // Parsed JSON object / array -- re-encode. JSON.stringify on
        // a parsed structure preserves semantics even if not byte-
        // identical to what the client sent (key order, whitespace),
        // which the BE doesn't care about.
        return new Uint8Array(Buffer.from(JSON.stringify(parsedBody), "utf-8"));
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(
            typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer)
        );
    }
    if (chunks.length === 0) return undefined;
    return new Uint8Array(Buffer.concat(chunks));
};

export const buildOutgoingHeadersFromWeb = (incoming: Headers): Headers => {
    const headers = new Headers();
    incoming.forEach((value, name) => {
        if (REQUEST_HOP_HEADERS.has(name.toLowerCase())) return;
        headers.append(name, value);
    });
    headers.set("x-forwarded-proto", "https");
    return headers;
};

export const copyUpstreamHeaders = (upstream: Headers): Headers => {
    const out = new Headers();
    const headersWithSetCookie = upstream as Headers & {
        getSetCookie?: () => string[];
    };
    if (typeof headersWithSetCookie.getSetCookie === "function") {
        for (const cookie of headersWithSetCookie.getSetCookie()) {
            out.append("set-cookie", cookie);
        }
    }
    upstream.forEach((value, name) => {
        const lower = name.toLowerCase();
        if (lower === "set-cookie") return;
        if (RESPONSE_HOP_HEADERS.has(lower)) return;
        out.append(name, value);
    });
    return out;
};

export const buildOutgoingHeaders = (req: IncomingMessage): Headers => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        if (REQUEST_HOP_HEADERS.has(name.toLowerCase())) continue;
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            for (const v of value) headers.append(name, v);
        } else {
            headers.set(name, value);
        }
    }
    // Tell the BE the original request was HTTPS so the auth router's
    // ``_session_cookie_secure`` puts ``Secure`` on the session cookie.
    // Vercel itself adds ``x-forwarded-proto`` on edge ingress but we
    // restate it here for the rewrite of older clients / curl probes.
    headers.set("x-forwarded-proto", "https");
    return headers;
};

export const writeUpstreamHeaders = (
    upstream: Headers,
    res: ServerResponse
): void => {
    // ``Set-Cookie`` can appear multiple times -- the standard
    // ``Headers.getSetCookie`` is the only API that surfaces them as
    // distinct entries. Older Node lacks it; the fallback collapses
    // duplicates into one comma-joined value, which corrupts the
    // attribute parser on the browser side, so we'd rather log loudly.
    const headersWithSetCookie = upstream as Headers & {
        getSetCookie?: () => string[];
    };
    if (typeof headersWithSetCookie.getSetCookie === "function") {
        const cookies = headersWithSetCookie.getSetCookie();
        if (cookies.length > 0) {
            res.setHeader("Set-Cookie", cookies);
        }
    }
    upstream.forEach((value, name) => {
        const lower = name.toLowerCase();
        if (lower === "set-cookie") return;
        if (RESPONSE_HOP_HEADERS.has(lower)) return;
        res.setHeader(name, value);
    });
};

export const handleProxyRequest = async (
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> => {
    try {
        const path = req.url ?? "/";
        const target = `${BACKEND_URL}${path}`;
        const headers = buildOutgoingHeaders(req);
        const body = await readRequestBody(req);

        const upstream = await fetch(target, {
            method: req.method,
            headers,
            // ``Uint8Array`` is a valid BodyInit at runtime (Node + every
            // modern browser) but TS's DOM lib hasn't caught up so we
            // cast through ``BodyInit`` to keep the type-checker quiet
            // without changing the wire-level behaviour.
            body: body as BodyInit | undefined,
            // ``manual`` so a 30x from the BE is faithfully relayed to
            // the browser rather than fetch() chasing the redirect and
            // potentially landing on a different origin (which would
            // strip the cookie chain the whole proxy exists to keep).
            redirect: "manual"
        });

        res.statusCode = upstream.status;
        writeUpstreamHeaders(upstream.headers, res);
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.end(buffer);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[api proxy] forwarding error", err);
        if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
        }
        res.end(JSON.stringify({ error: "Bad gateway" }));
    }
};

/**
 * Web Standard handler used by ``api/index.ts`` on Vercel. Vite
 * static deployments only pick up ``/api`` routes that export a
 * ``fetch`` method; the legacy ``(req, res)`` export was ignored in
 * production, so ``POST /api/v1/auth/login`` fell through to the SPA
 * ``index.html`` rewrite and returned 405 -- surfaced in the UI as
 * "Operation failed".
 */
export const handleProxyFetch = async (request: Request): Promise<Response> => {
    try {
        // Vercel rewrites can leave ``request.url`` path-only; ``new URL``
        // needs an absolute base. Pathname + search are all the proxy uses.
        const url = request.url.startsWith("http")
            ? new URL(request.url)
            : new URL(request.url, "https://proxy.local");
        const target = `${BACKEND_URL}${url.pathname}${url.search}`;
        const headers = buildOutgoingHeadersFromWeb(request.headers);
        const method = request.method.toUpperCase();
        const bodyBuffer =
            method === "GET" || method === "HEAD"
                ? undefined
                : await request.arrayBuffer();
        const body =
            bodyBuffer && bodyBuffer.byteLength > 0 ? bodyBuffer : undefined;

        const upstream = await fetch(target, {
            method: request.method,
            headers,
            body,
            redirect: "manual"
        });

        const buffer = await upstream.arrayBuffer();
        return new Response(buffer, {
            status: upstream.status,
            headers: copyUpstreamHeaders(upstream.headers)
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[api proxy] forwarding error", err);
        return Response.json({ error: "Bad gateway" }, { status: 502 });
    }
};
