import { QueryKey, useMutation, useQueryClient } from "@tanstack/react-query";
import { message } from "antd";

import { microcopy } from "../../constants/microcopy";
import filterRequest from "../filterRequest";
import getError from "../getError";

import useApi from "./useApi";

const getQueryKey = (
    queryKey: QueryKey | string | undefined,
    fallback: string
): QueryKey => {
    if (Array.isArray(queryKey)) {
        return queryKey;
    }

    return [queryKey ?? fallback];
};

type MutationParam = { [key: string]: unknown } | undefined;
type MutationContext = { previousItems: unknown };

const useReactMutation = <D>(
    endPoint: string,
    method: string,
    queryKey?: QueryKey | string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback?: (...args: any) => any,
    onError?: (err: Error) => void,
    setCache?: boolean
) => {
    const api = useApi();
    const queryClient = useQueryClient();
    const cacheKey = getQueryKey(queryKey, endPoint);
    const mutation = useMutation<D, unknown, MutationParam, MutationContext>({
        mutationFn: async (param) =>
            (await api(endPoint, {
                data: filterRequest(param || {}),
                method
            })) as D,
        onMutate: callback
            ? async (target: unknown) => {
                  const previousItems = queryClient.getQueryData(cacheKey);
                  queryClient.setQueryData(cacheKey, (old?: unknown[]) => {
                      const nextItems = callback(target, old);
                      return nextItems === undefined ? old : nextItems;
                  });
                  return { previousItems };
              }
            : undefined,
        onError: (err, _vars, context) => {
            if (callback && context) {
                queryClient.setQueryData(cacheKey, context.previousItems);
            }
            // Precedence: a caller-supplied `onError` owns the user-visible
            // feedback (forms surface it inline); we only auto-toast when an
            // optimistic update silently rolled back without anyone watching.
            if (onError) {
                onError(err instanceof Error ? err : getError(err));
            } else if (callback) {
                message.error(microcopy.feedback.optimisticReverted);
            }
        },
        onSuccess: setCache
            ? async (data: D) => queryClient.setQueryData(cacheKey, data)
            : () => queryClient.invalidateQueries({ queryKey: cacheKey })
    });

    return {
        ...mutation,
        isLoading: mutation.isPending
    };
};

export default useReactMutation;
