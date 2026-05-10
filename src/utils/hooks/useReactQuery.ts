import { QueryKey, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import filterRequest from "../filterRequest";
import getError from "../getError";

import useApi from "./useApi";

export const getReactQueryKey = (
    endPoint: string,
    queryParam?: { [key: string]: unknown },
    specialQueryKey?: string
): QueryKey =>
    queryParam
        ? [specialQueryKey || endPoint, filterRequest(queryParam)]
        : [endPoint];

const useReactQuery = <D>(
    endPoint: string,
    queryParam?: { [key: string]: unknown },
    specialQueryKey?: string,
    onSuccess?: (data: D) => void,
    onError?: (err: Error) => void,
    enabled = true,
    options?: {
        staleTime?: number;
    }
) => {
    const api = useApi();
    const successUpdatedAt = useRef(0);
    const errorUpdatedAt = useRef(0);

    const query = useQuery<D>({
        queryKey: getReactQueryKey(endPoint, queryParam, specialQueryKey),
        queryFn: async () =>
            (await api(endPoint, {
                data: filterRequest(queryParam || {}),
                method: "GET"
            })) as D,
        enabled,
        staleTime: options?.staleTime
    });

    useEffect(() => {
        if (
            onSuccess &&
            query.isSuccess &&
            query.dataUpdatedAt !== successUpdatedAt.current
        ) {
            successUpdatedAt.current = query.dataUpdatedAt;
            onSuccess(query.data);
        }
    }, [onSuccess, query.data, query.dataUpdatedAt, query.isSuccess]);

    useEffect(() => {
        if (
            onError &&
            query.isError &&
            query.errorUpdatedAt !== errorUpdatedAt.current
        ) {
            errorUpdatedAt.current = query.errorUpdatedAt;
            onError(getError(query.error));
        }
    }, [onError, query.error, query.errorUpdatedAt, query.isError]);

    return {
        ...query,
        isIdle: query.status === "pending" && query.fetchStatus === "idle"
    };
};

export default useReactQuery;
