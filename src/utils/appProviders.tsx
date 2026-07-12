import { ReactNode, useEffect, useState } from "react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Toaster } from "@/components/ui/toast";

import { LanguageProvider } from "../i18n";
import { store } from "../store";

import AuthProvider from "./authProvider";
import useColorScheme from "./hooks/useColorScheme";
import useGlassIntensity from "./hooks/useGlassIntensity";
import usePaletteTheme from "./hooks/usePaletteTheme";

const ThemedShell = ({ children }: { children: ReactNode }) => {
    const { scheme } = useColorScheme();
    /*
     * Phase 5 Wave 2 T4 — mount the glass-intensity resolver as a
     * sibling effect to the color-scheme writer. The hook reads
     * `userPreferences.glassIntensity` from the slice and writes the
     * effective intensity to `html[data-glass-intensity="…"]` via
     * useLayoutEffect, which the chrome CSS-var override blocks in
     * `cssVars.ts` pick up to flip every glass surface in one shot.
     *
     * ThemedShell sits inside the Redux Provider (mounted in
     * `AppProviders` below), so the hook's selector resolves
     * correctly. Mounting it once at this layer guarantees the
     * attribute lives on `<html>` for every routed page without each
     * page having to re-mount the bridge.
     */
    useGlassIntensity();
    /*
     * Runtime colour-theme resolver. Reads `userPreferences.colorTheme`
     * and re-renders the chosen palette's CSS into `#pulse-theme-vars`,
     * which re-colors every surface reading a `--pulse-*` var. Mounted
     * here for the same reason as `useGlassIntensity`: inside the Redux
     * Provider, once, so the vars live for every routed page.
     */
    usePaletteTheme();

    useEffect(() => {
        if (typeof document === "undefined") return;
        document.documentElement.dataset.colorScheme = scheme;
        document.documentElement.style.colorScheme = scheme;
    }, [scheme]);

    return (
        <>
            {children}
            {/*
             * sonner toast seam for the Tailwind + shadcn/ui surface.
             * `theme={scheme}` keeps it in sync with the app-wide light/dark
             * flip driven by `useColorScheme`.
             */}
            <Toaster theme={scheme} />
        </>
    );
};

const AppProviders = ({ children }: { children: ReactNode }) => {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 30_000,
                        retry: 1,
                        refetchOnWindowFocus: false
                    },
                    mutations: { retry: false }
                }
            })
    );
    return (
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <LanguageProvider>
                    <ThemedShell>
                        <AuthProvider>{children}</AuthProvider>
                    </ThemedShell>
                </LanguageProvider>
            </QueryClientProvider>
        </Provider>
    );
};

export default AppProviders;
