import environment from "../constants/env";

import getAuthErrorMessage from "./getAuthErrorMessage";
import { rewriteNetworkFetchError } from "./networkFetchError";
import { parseFetchBody } from "./parseFetchBody";
import { writeAiProxyToken } from "./tokenStorage";

const authFetch = async (
    endpoint: string,
    init: RequestInit
): Promise<Response> => {
    try {
        return await fetch(`${environment.apiBaseUrl}/${endpoint}`, {
            ...init,
            // Same-origin REST -- the HttpOnly ``Token`` cookie issued
            // by ``POST /auth/login`` rides with every subsequent
            // request thanks to the Vercel rewrite / Vite dev proxy.
            credentials: "include"
        });
    } catch (err) {
        const rewritten = rewriteNetworkFetchError(err);
        if (rewritten) throw rewritten;
        throw err;
    }
};

const failureMessage = (status: number, body: unknown): string =>
    status === 404 ? "Failed to connect" : getAuthErrorMessage(body);

const login = async (param: { email: string; password: string }) => {
    const res = await authFetch("auth/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(param)
    });
    const body = await parseFetchBody(res);
    if (res.ok) {
        // The REST JWT is no longer in the body -- the backend writes
        // it into the HttpOnly ``Token`` cookie which the browser
        // attaches automatically on every subsequent same-origin
        // call. We only stash ``ai_jwt`` (narrow-scope, short-TTL,
        // for the cross-origin AI proxy) so AI calls keep working
        // outside the cookie's reach.
        const user = body as IUser;
        if (typeof user.ai_jwt === "string" && user.ai_jwt.length > 0) {
            writeAiProxyToken(user.ai_jwt);
        }
        return user;
    }
    return Promise.reject(new Error(failureMessage(res.status, body)));
};

const register = async (param: {
    username: string;
    email: string;
    password: string;
}) => {
    const res = await authFetch("auth/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(param)
    });
    const body = await parseFetchBody(res);
    if (res.ok) {
        return body;
    }
    return Promise.reject(new Error(failureMessage(res.status, body)));
};

export { login, register };
