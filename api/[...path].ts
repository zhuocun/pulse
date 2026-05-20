/**
 * Vercel catch-all entry point for ``/api/*`` requests. All logic
 * lives in ``_proxy.ts`` so it stays in Jest's test discovery scope --
 * the bracketed filename here is required for Vercel's file-system
 * routing but the literal ``[...]`` characters interact poorly with
 * micromatch globbing.
 */
import { handleProxyRequest } from "./_proxy";

export default handleProxyRequest;

export const config = {
    // Node runtime is necessary for ``Headers.getSetCookie`` (the Edge
    // runtime's Headers shim collapses duplicate Set-Cookie values into
    // one comma-joined string, which the browser then mis-parses) and
    // for full IncomingMessage/ServerResponse semantics.
    runtime: "nodejs"
};
