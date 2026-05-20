import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import environment from "../../constants/env";
import { clearAiProxyToken } from "../tokenStorage";

import useCachedQueryData from "./useCachedQueryData";

const userQueryKey = ["users"] as const;

const useAuth = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const user = useCachedQueryData<IUser>(userQueryKey);
    /**
     * Authenticated state is derived from the React Query cache,
     * which the ``AuthProvider`` populates by fetching ``GET /users``
     * (the cookie issued by ``/auth/login`` rides along). A cached
     * ``user._id`` is the only "we have a session" hint the FE has
     * post-cookie -- the REST JWT itself lives in an HttpOnly cookie
     * and is never readable from JS.
     */
    const isAuthenticated = !!user?._id;
    const logout = useCallback(async () => {
        // Tell the backend to clear the HttpOnly cookie. The browser
        // cannot remove ``HttpOnly`` cookies from JS; only a
        // server-side ``Set-Cookie`` with ``Max-Age=0`` does that.
        try {
            await fetch(`${environment.apiBaseUrl}/auth/logout`, {
                method: "POST",
                credentials: "include"
            });
        } catch {
            // Best-effort: a transient network failure here just
            // leaves the cookie in place until it expires. The local
            // session is cleared regardless so the UI does not lie.
        }
        clearAiProxyToken();
        queryClient.clear();
        navigate("/login", { viewTransition: true });
    }, [navigate, queryClient]);
    return {
        user,
        isAuthenticated,
        logout
    };
};

export default useAuth;
