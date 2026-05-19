import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import {
    clearAuthToken,
    readAuthToken,
    subscribeAuthToken
} from "../tokenStorage";
import useCachedQueryData from "./useCachedQueryData";

const userQueryKey = ["users"] as const;

const isUnauthorizedError = (error: unknown): boolean => {
    if (error && typeof error === "object" && "status" in error) {
        const status = (error as { status?: unknown }).status;
        if (typeof status === "number") {
            return status === 401;
        }
    }
    const message =
        error instanceof Error ? error.message : String(error ?? "");
    return /unauthorized/i.test(message);
};

const useAuth = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const user = useCachedQueryData<IUser>(userQueryKey);
    const token = useSyncExternalStore(
        subscribeAuthToken,
        readAuthToken,
        () => null
    );
    const clear = useCallback(async () => {
        queryClient.clear();
        clearAuthToken();
    }, [queryClient]);
    const logout = useCallback(() => {
        clear().then(() => navigate("/login", { viewTransition: true }));
    }, [clear, navigate]);
    const refreshUser = useCallback(async () => {
        if (token && (!user || user.jwt !== token)) {
            try {
                await queryClient.refetchQueries({ queryKey: userQueryKey });
                const queryState =
                    queryClient.getQueryState<IUser>(userQueryKey);
                const refreshed = queryClient.getQueryData<IUser>(userQueryKey);
                if (queryState?.status === "error" || !refreshed) {
                    throw (
                        queryState?.error ?? new Error("Failed to refresh user")
                    );
                }
                queryClient.setQueryData<IUser>(userQueryKey, {
                    ...refreshed,
                    jwt: token
                });
            } catch (err) {
                // Only clear the session on a confirmed 401. Any other error
                // (Safari Mobile "Load failed", Vercel cold-start timeouts,
                // CORS, 5xx) is transient — the stored JWT is still valid
                // and should not be discarded, otherwise the user is bounced
                // back to /login right after a successful login. The cached
                // user, when present, is patched so downstream consumers see
                // a stable `user.jwt === token`.
                if (isUnauthorizedError(err)) {
                    await clear();
                    navigate("/login", { viewTransition: true });
                    return;
                }
                const cached = queryClient.getQueryData<IUser>(userQueryKey);
                if (cached) {
                    queryClient.setQueryData<IUser>(userQueryKey, {
                        ...cached,
                        jwt: token
                    });
                }
            }
        }
    }, [clear, navigate, queryClient, token, user]);
    return {
        user,
        logout,
        token,
        refreshUser
    };
};

export default useAuth;
