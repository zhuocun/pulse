import qs from "qs";
import { useCallback } from "react";

import environment from "../../constants/env";

import extractErrorMessage from "../extractErrorMessage";
import { parseFetchBody } from "../parseFetchBody";
import { rewriteNetworkFetchError } from "../networkFetchError";

import useAuth from "./useAuth";

interface IConfig extends RequestInit {
    data?: object;
    token?: string | null;
}

export const api = async (
    endpoint: string,
    { data, token, ...customConfig }: IConfig = {}
) => {
    let apiEndpoint = endpoint;
    const headers: Record<string, string> = {};
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    if (data) {
        headers["Content-Type"] = "application/json";
    }
    const config = {
        method: "GET",
        headers,
        ...customConfig
    };

    if (
        config.method.toUpperCase() === "GET" ||
        config.method.toUpperCase() === "DELETE"
    ) {
        const qsString = qs.stringify(data ?? {});
        if (qsString) {
            apiEndpoint += `?${qsString}`;
        }
    } else {
        config.body = JSON.stringify(data);
    }

    let res: Response;
    try {
        res = await fetch(`${environment.apiBaseUrl}/${apiEndpoint}`, config);
    } catch (err) {
        const rewritten = rewriteNetworkFetchError(err);
        if (rewritten) {
            return Promise.reject(rewritten);
        }
        throw err;
    }
    const resData = await parseFetchBody(res);
    if (res.ok) {
        return resData;
    }
    const error = new Error(
        extractErrorMessage(resData) ?? "Operation failed"
    ) as Error & { status?: number };
    // Surface the HTTP status so callers (notably `useAuth.refreshUser`) can
    // tell a real 401 from a transient network / 5xx failure. The fallback
    // message text alone is unreliable — the backend's 401 body is
    // `{"error": "empty JWT"}` etc., which the message extractor surfaces
    // as "empty JWT" and the previous regex-on-message check missed.
    error.status = res.status;
    return Promise.reject(error);
};

const useApi = () => {
    const { user, token } = useAuth();
    return useCallback(
        (...[endpoint, config]: Parameters<typeof api>) =>
            api(endpoint, {
                ...config,
                token: user?.jwt ?? token
            }),
        [token, user?.jwt]
    );
};

export default useApi;
