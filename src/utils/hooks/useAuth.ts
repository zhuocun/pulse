import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import {
    clearAuthToken,
    readAuthToken,
    subscribeAuthToken
} from "../tokenStorage";

const useAuth = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const userQueryKey = ["users"];
    const user = queryClient.getQueryData<IUser>(userQueryKey);
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
            } catch {
                await clear();
                navigate("/login", { viewTransition: true });
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
