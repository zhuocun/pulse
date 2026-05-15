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
    return Promise.reject(
        new Error(extractErrorMessage(resData) ?? "Operation failed")
    );
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
