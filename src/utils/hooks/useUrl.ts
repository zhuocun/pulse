import { useCallback, useMemo, useState } from "react";
import {
    NavigateOptions,
    URLSearchParamsInit,
    useSearchParams
} from "react-router-dom";

import filterRequest from "../filterRequest";

const useUrl = <K extends string>(keys: K[]) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [stateKeys] = useState(keys);
    const setUrlParams = useCallback(
        (
            params: Partial<{ [key in K]: unknown }>,
            options?: NavigateOptions
        ) => {
            setSearchParams((prev) => {
                const obj = filterRequest({
                    ...Object.fromEntries(prev.entries()),
                    ...params
                }) as URLSearchParamsInit;
                return obj;
            }, options);
        },
        [setSearchParams]
    );

    return [
        useMemo(
            () =>
                stateKeys.reduce(
                    (prev, key) => {
                        return { ...prev, [key]: searchParams.get(key) };
                    },
                    {} as { [key in K]: string | null }
                ),
            [searchParams, stateKeys]
        ),
        setUrlParams
    ] as const;
};

export default useUrl;
