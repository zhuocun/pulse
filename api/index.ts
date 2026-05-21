/**
 * Vercel entry point for every ``/api/*`` request on the FE deployment.
 *
 * Non-Next.js Vercel projects only support **single-segment** dynamic
 * routes under ``/api`` (``api/users/[id].ts``). Catch-all filenames
 * like ``api/[...path].ts`` are a Next.js feature — they do **not**
 * match nested paths such as ``/api/v1/auth/login``, which is why
 * production returned Vercel's plain-text ``NOT_FOUND`` page and the
 * login form surfaced "The page could not be found".
 *
 * ``vercel.json`` rewrites ``/api/:path*`` → ``/api`` so this one
 * function receives the full original URL in ``request.url`` and can
 * forward ``/api/v1/...`` to the Python backend with cookies intact.
 *
 * Uses the Node ``(req, res)`` default export — the Web Standard
 * ``export default { fetch }`` object (especially with an imported
 * ``fetch`` reference) was not reliably invoked on this Vite static
 * deploy and surfaced as Vercel ``FUNCTION_INVOCATION_FAILED``.
 */
import { handleProxyRequest } from "./_proxy";

export default handleProxyRequest;

export const config = {
    // Node runtime is necessary for ``Headers.getSetCookie`` (the Edge
    // runtime's Headers shim collapses duplicate Set-Cookie values into
    // one comma-joined string, which the browser then mis-parses) and
    // for full IncomingMessage/ServerResponse semantics.
    runtime: "nodejs" as const,
    api: {
        // Vercel auto-parses JSON / form bodies on ingress, which
        // drains the underlying stream before the handler runs --
        // leaving a body-less POST to forward to the BE (the bug
        // that surfaced as "Operation failed" on the login screen).
        // ``_proxy.ts`` ALSO handles a pre-parsed ``req.body`` for
        // safety in case this flag is ignored by a future Vercel
        // runtime change.
        bodyParser: false
    }
};
