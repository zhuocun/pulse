import environment from "../constants/env";
import { microcopy } from "../constants/microcopy";

import getAuthErrorMessage from "./getAuthErrorMessage";
import { parseFetchBody } from "./parseFetchBody";
import { writeAuthToken } from "./tokenStorage";

/**
 * Mirrors the network-error narrowing in `useApi.ts` so offline / DNS / CORS
 * failures surface a friendly message in the auth forms instead of the raw
 * `TypeError("Failed to fetch")` browser string.
 */
const isNetworkError = (err: unknown): boolean =>
    err instanceof TypeError && err.message.toLowerCase().includes("fetch");

const authFetch = async (
    endpoint: string,
    init: RequestInit
): Promise<Response> => {
    try {
        return await fetch(`${environment.apiBaseUrl}/${endpoint}`, init);
    } catch (err) {
        if (isNetworkError(err)) {
            throw new Error(microcopy.feedback.networkError, { cause: err });
        }
        throw err;
    }
};

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
        writeAuthToken(user.jwt);
        return user;
    }
    const errMsg =
        res.status === 404 ? "Failed to connect" : getAuthErrorMessage(body);
    return Promise.reject(new Error(errMsg));
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
    const errMsg =
        res.status === 404 ? "Failed to connect" : getAuthErrorMessage(body);
    return Promise.reject(new Error(errMsg));
};

export { login, register };
