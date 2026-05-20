import React, { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { PageSpin } from "../components/status";

import useApi from "./hooks/useApi";
import useCachedQueryData from "./hooks/useCachedQueryData";

const userQueryKey = ["users"] as const;

/**
 * Single-shot session probe.
 *
 * Renders ``<PageSpin />`` until ``GET /users`` resolves (success or
 * failure), then yields to the route tree. The HttpOnly session
 * cookie issued by ``POST /auth/login`` rides along automatically;
 * a 401 leaves the cache empty and downstream guards
 * (``HomePage`` / ``RootRedirect``) bounce to ``/login``. A 200
 * populates the cache and the route guard renders the app.
 *
 * The probe is intentionally unconditional. The previous design
 * (``Boolean(token)`` gated the fetch on a JS-readable token) was
 * what forced the JWT into ``localStorage`` in the first place --
 * and on iOS Safari 26.5 that storage handoff was unreliable across
 * the post-login document reload. Always-fire trades a brief
 * spinner on every cold boot for a robust source of truth.
 */
const AuthProvider = ({ children }: { children: ReactNode }) => {
    const api = useApi();
    const { isLoading, isFetching } = useQuery({
        queryKey: userQueryKey,
        queryFn: async () => (await api("users")) as IUser,
        retry: false,
        // Disable refetch-on-mount triggers from per-page renders;
        // we own the lifecycle here and ``useAuth.logout`` clears
        // the cache, which is the only path that needs a re-probe.
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity
    });
    const cached = useCachedQueryData<IUser>(userQueryKey);

    // First-paint: no cached user AND the probe hasn't resolved yet.
    // After the first response we let the route guards decide what to
    // do; a 401 / network error simply leaves ``cached`` empty and the
    // guards redirect to ``/login``.
    if (!cached && (isLoading || isFetching)) {
        return <PageSpin />;
    }

    return <div>{children}</div>;
};

export default AuthProvider;
