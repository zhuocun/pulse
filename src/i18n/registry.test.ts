import dayjs from "dayjs";

import {
    applyDayjsLocale,
    DEFAULT_LOCALE,
    detectInitialLocale,
    getLocaleEntry,
    isLocaleCode,
    LOCALES,
    persistLocale
} from "./registry";

const STORAGE_KEY = "pulse.locale";

describe("i18n/registry", () => {
    afterEach(() => {
        window.localStorage.clear();
    });

    describe("LOCALES table", () => {
        it("ships entries for both supported locales", () => {
            const codes = LOCALES.map((entry) => entry.code).sort();
            expect(codes).toEqual(["en", "zh-CN"]);
        });

        it("each entry exposes the required fields", () => {
            for (const entry of LOCALES) {
                expect(typeof entry.code).toBe("string");
                expect(typeof entry.nativeName).toBe("string");
                expect(typeof entry.englishName).toBe("string");
                expect(typeof entry.dayjs).toBe("string");
                expect(typeof entry.htmlLang).toBe("string");
                expect(entry.dictionary).toBeTruthy();
                expect(entry.antd).toBeTruthy();
            }
        });
    });

    describe("getLocaleEntry", () => {
        it("returns the canonical entry for a known code", () => {
            const entry = getLocaleEntry("zh-CN");
            expect(entry.code).toBe("zh-CN");
            expect(entry.htmlLang).toBe("zh-CN");
        });

        it("falls back to the default locale for an unknown code", () => {
            const entry = getLocaleEntry("xx-YY" as never);
            expect(entry.code).toBe(DEFAULT_LOCALE);
        });
    });

    describe("isLocaleCode", () => {
        it("returns true for valid codes", () => {
            expect(isLocaleCode("en")).toBe(true);
            expect(isLocaleCode("zh-CN")).toBe(true);
        });

        it("returns false for unknown / non-string values", () => {
            expect(isLocaleCode("xx")).toBe(false);
            expect(isLocaleCode("EN")).toBe(false);
            expect(isLocaleCode(123)).toBe(false);
            expect(isLocaleCode(null)).toBe(false);
            expect(isLocaleCode(undefined)).toBe(false);
        });
    });

    describe("detectInitialLocale", () => {
        const originalLanguage = navigator.language;

        afterEach(() => {
            Object.defineProperty(navigator, "language", {
                configurable: true,
                get: () => originalLanguage
            });
        });

        const stubLanguage = (value: string) => {
            Object.defineProperty(navigator, "language", {
                configurable: true,
                get: () => value
            });
        };

        it("returns the persisted locale when one is stored", () => {
            window.localStorage.setItem(STORAGE_KEY, "zh-CN");
            expect(detectInitialLocale()).toBe("zh-CN");
        });

        it("ignores an unknown stored value", () => {
            window.localStorage.setItem(STORAGE_KEY, "xx-YY");
            stubLanguage("en-US");
            // Falls through to the navigator-language heuristic ("en-US" →
            // language-only prefix "en" → locale "en").
            expect(detectInitialLocale()).toBe("en");
        });

        it("returns an exact navigator.language match when no stored value", () => {
            stubLanguage("zh-CN");
            expect(detectInitialLocale()).toBe("zh-CN");
        });

        it("returns a language-prefix match (zh → zh-CN)", () => {
            stubLanguage("zh");
            expect(detectInitialLocale()).toBe("zh-CN");
        });

        it("returns DEFAULT_LOCALE when no signals match", () => {
            stubLanguage("fr-FR");
            expect(detectInitialLocale()).toBe(DEFAULT_LOCALE);
        });
    });

    describe("persistLocale", () => {
        it("writes the code to localStorage", () => {
            persistLocale("zh-CN");
            expect(window.localStorage.getItem(STORAGE_KEY)).toBe("zh-CN");
        });

        it("does not throw if localStorage throws (private mode)", () => {
            const spy = jest
                .spyOn(Storage.prototype, "setItem")
                .mockImplementation(() => {
                    throw new Error("quota");
                });
            try {
                expect(() => persistLocale("en")).not.toThrow();
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe("applyDayjsLocale", () => {
        afterEach(() => {
            // Restore default for downstream suites.
            dayjs.locale("en");
        });

        it("switches the dayjs global locale", () => {
            applyDayjsLocale("zh-CN");
            expect(dayjs.locale()).toBe("zh-cn");
            applyDayjsLocale("en");
            expect(dayjs.locale()).toBe("en");
        });

        it("falls back to the default locale for an unknown code", () => {
            applyDayjsLocale("xx-YY" as never);
            expect(dayjs.locale()).toBe("en");
        });
    });
});
