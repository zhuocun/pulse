import { readAiProxyToken } from "./tokenStorage";

/**
 * Bearer for AI / agent routes.
 *
 * The REST JWT now lives in an HttpOnly ``Token`` cookie that JS
 * cannot read, so it can no longer serve as a fallback here. AI
 * routes need an explicit bearer because they often live on a
 * different origin from the cookie's host (configurable via
 * ``REACT_APP_AI_BASE_URL``); when the call resolves to the same
 * origin via the Vercel rewrite the cookie also rides along, and
 * the backend accepts whichever transport arrives.
 */
export const getStoredBearerAuthHeader = (): string => {
    const narrow = readAiProxyToken();
    return narrow ? `Bearer ${narrow}` : "";
};
