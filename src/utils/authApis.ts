import environment from "../constants/env";
import { microcopy } from "../constants/microcopy";

import getAuthErrorMessage from "./getAuthErrorMessage";
import { rewriteNetworkFetchError } from "./networkFetchError";
import { parseFetchBody } from "./parseFetchBody";
import { writeAiProxyToken, writeAuthToken } from "./tokenStorage";

const authFetch = async (
    endpoint: string,
    init: RequestInit
): Promise<Response> => {
    try {
        return await fetch(`${environment.apiBaseUrl}/${endpoint}`, init);
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
        const user = body as IUser;
        // Defend against a malformed login envelope: storing
        // `"undefined"` would poison every subsequent request with
        // `Authorization: Bearer undefined` and the user would only
        // discover it after the next 401. Reject the response loudly
        // so the auth form can surface a real error.
        if (typeof user?.jwt !== "string" || user.jwt.length === 0) {
            return Promise.reject(new Error("Login response missing token"));
        }
        if (!writeAuthToken(user.jwt)) {
            return Promise.reject(
                new Error(microcopy.feedback.loginCouldNotPersistSession)
            );
        }
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
