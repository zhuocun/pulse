/**
 * Locale registry — adding a new language is a one-stop change here:
 *
 *   1. Add a `*.ts` dictionary under `src/i18n/locales/` whose default export
 *      satisfies `Dictionary` (the type makes missing keys a compile error).
 *   2. Add a `LOCALES` row pointing at the new dictionary and the `dayjs`
 *      locale identifier.
 *   3. (Optional) import the dayjs locale once in this module — dayjs
 *      registers itself globally so the call only needs to happen once.
 *
 * The rest of the codebase reads the active locale through `useTranslation`,
 * `useLocale`, or `getActiveDictionary`, so nothing else needs to change.
 */
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import "dayjs/locale/en";

import en from "./locales/en";
import zhCNDict from "./locales/zh-CN";
import type { Dictionary } from "./types";

export type LocaleCode = "en" | "zh-CN";

export interface LocaleEntry {
    /** Stable identifier persisted to localStorage and reflected in `<html lang>`. */
    readonly code: LocaleCode;
    /** Native-script display name (shown in language pickers). */
    readonly nativeName: string;
    /** English display name (used in tooltips / aria-labels). */
    readonly englishName: string;
    /** Active dictionary for this locale. */
    readonly dictionary: Dictionary;
    /** dayjs locale identifier (must be imported once at module top). */
    readonly dayjs: string;
    /** Value for the `<html lang>` attribute. */
    readonly htmlLang: string;
}

export const DEFAULT_LOCALE: LocaleCode = "en";

export const LOCALES: readonly LocaleEntry[] = [
    {
        code: "en",
        nativeName: "English",
        englishName: "English",
        dictionary: en as unknown as Dictionary,
        dayjs: "en",
        htmlLang: "en"
    },
    {
        code: "zh-CN",
        nativeName: "中文",
        englishName: "Chinese (Simplified)",
        dictionary: zhCNDict,
        dayjs: "zh-cn",
        htmlLang: "zh-CN"
    }
];

const LOCALE_BY_CODE: Record<LocaleCode, LocaleEntry> = LOCALES.reduce(
    (acc, entry) => {
        acc[entry.code] = entry;
        return acc;
    },
    {} as Record<LocaleCode, LocaleEntry>
);

export const getLocaleEntry = (code: LocaleCode): LocaleEntry =>
    LOCALE_BY_CODE[code] ?? LOCALE_BY_CODE[DEFAULT_LOCALE];

export const isLocaleCode = (value: unknown): value is LocaleCode =>
    typeof value === "string" && value in LOCALE_BY_CODE;

const STORAGE_KEY = "pulse.locale";

/**
 * Reads the persisted locale, falling back to the browser's language and
 * finally to `DEFAULT_LOCALE`. Tolerates missing localStorage (SSR / tests
 * with `jsdom` window stripped) and refuses to deserialize unknown codes.
 */
export const detectInitialLocale = (): LocaleCode => {
    if (typeof window === "undefined") return DEFAULT_LOCALE;
    try {
        const stored = window.localStorage?.getItem(STORAGE_KEY);
        if (isLocaleCode(stored)) return stored;
    } catch {
        // Access can throw in private mode / sandboxed iframes — fall through.
    }
    const navigatorLang =
        typeof navigator !== "undefined" ? navigator.language : undefined;
    if (navigatorLang) {
        // Exact match first ("zh-CN" → "zh-CN"), then language-only match
        // ("zh" → "zh-CN") so a Chinese browser locale picks up the bundle.
        if (isLocaleCode(navigatorLang)) return navigatorLang;
        const prefix = navigatorLang.split("-")[0];
        const found = LOCALES.find((locale) => locale.code.startsWith(prefix));
        if (found) return found.code;
    }
    return DEFAULT_LOCALE;
};

export const persistLocale = (code: LocaleCode): void => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage?.setItem(STORAGE_KEY, code);
    } catch {
        // Ignore — quota errors / disabled storage shouldn't crash the UI.
    }
};

/** Applies the dayjs locale globally. dayjs is a singleton, so this affects
 * every component that uses `dayjs()` to format relative times. */
export const applyDayjsLocale = (code: LocaleCode): void => {
    dayjs.locale(getLocaleEntry(code).dayjs);
};
