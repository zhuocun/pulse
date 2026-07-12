import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import en from "./locales/en";
import {
    applyDayjsLocale,
    DEFAULT_LOCALE,
    detectInitialLocale,
    getLocaleEntry,
    LOCALES,
    persistLocale,
    type LocaleCode,
    type LocaleEntry
} from "./registry";
import { setActiveLocale } from "./active";
import type { Dictionary } from "./types";

interface LanguageContextValue {
    readonly locale: LocaleCode;
    readonly entry: LocaleEntry;
    readonly dictionary: Dictionary;
    readonly availableLocales: readonly LocaleEntry[];
    readonly setLocale: (code: LocaleCode) => void;
}

const defaultEntry = getLocaleEntry(DEFAULT_LOCALE);

const LanguageContext = createContext<LanguageContextValue>({
    locale: DEFAULT_LOCALE,
    entry: defaultEntry,
    dictionary: en as unknown as Dictionary,
    availableLocales: LOCALES,
    setLocale: () => {
        /* no-op: hook used outside of provider falls back to English. */
    }
});

/**
 * Top-level provider that owns the active locale.
 *
 * Components subscribe via `useLocale` (locale code + setter) or
 * `useTranslation` (dictionary). Here we manage locale state,
 * side-effects (singleton, dayjs, `<html lang>`, persistence), and force
 * a remount of the subtree on every language switch.
 *
 * The keyed remount is the safety net for components that read the static
 * `microcopy` Proxy rather than `useTranslation` — without it, they would
 * keep rendering the previous language until something else triggered a
 * re-render. Language switches are rare, so the brief state reset is an
 * acceptable cost.
 */
export const LanguageProvider = ({ children }: { children: ReactNode }) => {
    const [locale, setLocaleState] = useState<LocaleCode>(() => {
        const initial = detectInitialLocale();
        // Prime the singleton + dayjs *before* the first render so the very
        // first paint already uses the persisted language.
        setActiveLocale(initial);
        applyDayjsLocale(initial);
        return initial;
    });

    const entry = useMemo(() => getLocaleEntry(locale), [locale]);

    useEffect(() => {
        setActiveLocale(locale);
        applyDayjsLocale(locale);
        persistLocale(locale);
        if (typeof document !== "undefined") {
            document.documentElement.setAttribute("lang", entry.htmlLang);
        }
    }, [locale, entry.htmlLang]);

    const value = useMemo<LanguageContextValue>(
        () => ({
            locale,
            entry,
            dictionary: entry.dictionary,
            availableLocales: LOCALES,
            setLocale: (next: LocaleCode) => {
                if (next === locale) return;
                // Update the singleton synchronously so any module read in
                // the same tick (e.g. a thrown error message that wraps a
                // microcopy string) already gets the new language.
                setActiveLocale(next);
                applyDayjsLocale(next);
                setLocaleState(next);
            }
        }),
        [locale, entry]
    );

    return (
        <LanguageContext.Provider value={value}>
            <div key={locale} style={{ display: "contents" }}>
                {children}
            </div>
        </LanguageContext.Provider>
    );
};

/**
 * Subscribes to the active locale and provides a setter. Components that
 * need to render the *current* dictionary should call `useTranslation`
 * instead — this hook is for code that needs the locale code itself
 * (language switcher, locale-aware formatters, analytics tags).
 */
export const useLocale = () => {
    const { locale, entry, availableLocales, setLocale } =
        useContext(LanguageContext);
    return { locale, entry, availableLocales, setLocale };
};

/**
 * Returns the active dictionary. Idiomatic usage:
 *
 *   const t = useTranslation();
 *   return <button>{t.actions.save}</button>;
 *
 * Components that already import the static `microcopy` constant don't need
 * to migrate — that constant is a Proxy onto the same active dictionary —
 * but new code should prefer this hook because it makes the React data flow
 * explicit and triggers re-renders without relying on the provider's
 * keyed-remount fallback.
 */
export const useTranslation = (): Dictionary =>
    useContext(LanguageContext).dictionary;
