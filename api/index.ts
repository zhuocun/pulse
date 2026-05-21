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
 */
import { handleProxyFetch } from "./_proxy";

export default {
    fetch: handleProxyFetch
};
