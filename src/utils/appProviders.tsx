import { App as AntdApp, ConfigProvider } from "antd";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { LanguageProvider, useLocale } from "../i18n";
import { store } from "../store";
import { buildAntdTheme } from "../theme/antdTheme";

import AuthProvider from "./authProvider";
import useColorScheme from "./hooks/useColorScheme";
import useGlassIntensity from "./hooks/useGlassIntensity";
import usePaletteTheme from "./hooks/usePaletteTheme";

const usePointerCoarse = () => {
    const [coarse, setCoarse] = useState<boolean>(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return false;
        }
        return window.matchMedia("(pointer: coarse)").matches;
    });

    useEffect(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return;
        }
        const media = window.matchMedia("(pointer: coarse)");
        const handler = (event: MediaQueryListEvent) =>
            setCoarse(event.matches);
        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", handler);
            return () => media.removeEventListener("change", handler);
        }
        media.addListener(handler);
        return () => media.removeListener(handler);
    }, []);

    return coarse;
};

const ThemedShell = ({ children }: { children: ReactNode }) => {
    const { scheme } = useColorScheme();
    const { entry: localeEntry } = useLocale();
    const coarse = usePointerCoarse();
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
     * Runtime colour-theme resolver. Reads `userPreferences.colorTheme`,
     * re-renders the chosen palette's CSS into `#pulse-theme-vars` (which
     * re-colors every styled-component reading a `--pulse-*` var), and
     * returns the resolved Palette object. We thread that object into
     * `buildAntdTheme` so AntD's algorithmic shade derivation tracks the
     * same palette — both surfaces re-color in one shot. Mounted here for
     * the same reason as `useGlassIntensity`: inside the Redux Provider,
     * once, so the attribute/vars live for every routed page.
     */
    const activePalette = usePaletteTheme();
    const themeConfig = useMemo(
        () => buildAntdTheme(scheme, coarse, activePalette),
        [scheme, coarse, activePalette]
    );

    useEffect(() => {
        if (typeof document === "undefined") return;
        document.documentElement.dataset.colorScheme = scheme;
        document.documentElement.style.colorScheme = scheme;
        /*
         * AntD v6 with `cssVar: { key: "ant" }` scopes its CSS variables to
         * `:where(.ant)`, the class it adds to its own components. Any styled
         * component that reads `var(--ant-color-bg-container, …)` from the
         * page chrome (header, project table, stat cards, modal portals)
         * therefore falls back to its hard-coded light value. Putting the
         * `ant` class on `<html>` makes the variables cascade to the entire
         * document so dark mode actually flips every surface.
         */
        document.documentElement.classList.add("ant");
    }, [scheme]);

    return (
        <ConfigProvider theme={themeConfig} locale={localeEntry.antd}>
            {/*
             * AntD v6 warns when `cssVar` is enabled (set in
             * `buildAntdTheme` as `cssVar: { key: "ant" }`) AND `App` is
             * mounted with `component={false}` — the cssVar styles are
             * generated as a class scoped to the App's root element, so
             * disabling that root means components inside the App can't
             * pick up the scoped CSS variables. Letting `component`
             * default to `"div"` mounts a single `<div class="ant-app">`
             * around the app tree so the cssVar block has a host. The
             * extra div is block-level and inherits sizing from `#root`,
             * so it does not change layout for any routed page.
             */}
            <AntdApp
                notification={{ placement: "topRight" }}
                message={{ maxCount: 3 }}
            >
                {children}
            </AntdApp>
        </ConfigProvider>
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
