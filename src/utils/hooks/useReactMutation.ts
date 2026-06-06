import { QueryKey, useMutation, useQueryClient } from "@tanstack/react-query";

import { microcopy } from "../../constants/microcopy";
import filterRequest from "../filterRequest";
import getError from "../getError";

import useApi from "./useApi";
import useAppMessage from "./useAppMessage";

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
type MutationContext = {
    previousItems: unknown;
    didApplyOptimistic: boolean;
};
type OptimisticUpdateCallback = {
    bivarianceHack(target: unknown, old?: unknown): unknown | undefined;
}["bivarianceHack"];

const useReactMutation = <D>(
    endPoint: string,
    method: string,
    queryKey?: QueryKey | string,
    callback?: OptimisticUpdateCallback,
    onError?: (err: Error) => void,
    setCache?: boolean,
    // Opt-in escape hatch threaded straight into `filterRequest`: keys listed
    // here survive as long as their value isn't `undefined` (so an explicit
    // `null`/`""` reaches the wire to CLEAR the field). Omitting it (every
    // existing caller) leaves the default void-stripping untouched.
    preserveNullKeys?: readonly string[]
) => {
    // AntD v6: the static `message` import warns it can't read dynamic
    // theme. `useAppMessage()` returns a theme-aware instance (with a
    // static fallback for tests that render without `<App>`).
    const message = useAppMessage();
    const api = useApi();
    const queryClient = useQueryClient();
    const cacheKey = getQueryKey(queryKey, endPoint);
    const mutation = useMutation<D, unknown, MutationParam, MutationContext>({
        mutationFn: async (param) =>
            (await api(endPoint, {
                data: filterRequest(param || {}, preserveNullKeys),
                method
            })) as D,
        onMutate: callback
            ? async (target: unknown) => {
                  const previousItems = queryClient.getQueryData(cacheKey);
                  let didApplyOptimistic = false;
                  queryClient.setQueryData(cacheKey, (old?: unknown) => {
                      const next = callback(target, old);
                      if (next === undefined || Object.is(next, old)) {
                          return old;
                      }
                      didApplyOptimistic = true;
                      return next;
                  });
                  return { previousItems, didApplyOptimistic };
              }
            : undefined,
        onError: (err, _vars, context) => {
            if (callback && context?.didApplyOptimistic) {
                queryClient.setQueryData(cacheKey, context.previousItems);
            }
            // Precedence: a caller-supplied `onError` owns the user-visible
            // feedback (forms surface it inline); we only auto-toast when an
            // optimistic update silently rolled back without anyone watching.
            if (onError) {
                onError(err instanceof Error ? err : getError(err));
            } else if (callback && context?.didApplyOptimistic) {
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
