import { microcopy } from "../constants/microcopy";

import {
    getActiveDictionary,
    getActiveLocaleCode,
    setActiveLocale
} from "./active";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

describe("i18n/active singleton", () => {
    afterEach(() => {
        // Restore the default locale so unrelated tests still see English.
        setActiveLocale("en");
    });

    it("starts seeded with the English dictionary and 'en' locale code", () => {
        setActiveLocale("en");
        expect(getActiveLocaleCode()).toBe("en");
        // Identity-comparable to the imported English bundle.
        expect(getActiveDictionary()).toBe(en);
    });

    it("setActiveLocale flips both the dictionary and the locale code", () => {
        setActiveLocale("zh-CN");
        expect(getActiveLocaleCode()).toBe("zh-CN");
        expect(getActiveDictionary()).toBe(zhCN);

        setActiveLocale("en");
        expect(getActiveLocaleCode()).toBe("en");
        expect(getActiveDictionary()).toBe(en);
    });

    it("setActiveLocale with an unknown code falls back to the default locale", () => {
        setActiveLocale("xx-YY" as never);
        expect(getActiveLocaleCode()).toBe("en");
        expect(getActiveDictionary()).toBe(en);
    });

    it("the microcopy Proxy resolves against the active dictionary", () => {
        setActiveLocale("en");
        const englishCancel = microcopy.actions.cancel;
        setActiveLocale("zh-CN");
        // After switching, a fresh read of the same key returns the Chinese
        // value — confirms the Proxy reads at access time, not at module load.
        expect(microcopy.actions.cancel).not.toBe(englishCancel);
        expect(microcopy.actions.cancel).toBe(zhCN.actions.cancel);
    });
});
