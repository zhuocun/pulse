/**
 * Vercel catch-all entry point for ``/api/*`` requests. All logic
 * lives in ``_proxy.ts`` so it stays in Jest's test discovery scope --
 * the bracketed filename here is required for Vercel's file-system
 * routing but the literal ``[...]`` characters interact poorly with
 * micromatch globbing.
 *
 * Exports the Web Standard ``fetch`` handler Vercel expects for
 * non-Next.js projects. The previous ``(req, res)`` default export was
 * not deployed alongside the Vite static build, so production routed
 * ``POST /api/v1/auth/login`` to ``index.html`` (405) and the login
 * form showed the generic "Operation failed" message.
 */
import { handleProxyFetch } from "./_proxy";

export default {
    fetch: handleProxyFetch
};
