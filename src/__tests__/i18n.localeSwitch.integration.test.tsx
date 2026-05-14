/**
 * Integration test for the locale-switch propagation contract.
 *
 * `LanguageSwitcher` changes the active locale via `useLocale().setLocale`,
 * which:
 *   1. Updates the active-dictionary singleton synchronously.
 *   2. Persists the choice to localStorage.
 *   3. Updates `<html lang>`.
 *   4. Forces a remount of the LanguageProvider subtree so static
 *      `microcopy.x.y` reads re-evaluate against the new dictionary.
 *
 * Without integration coverage, a regression that broke any one of those
 * side-effects could ship: the unit test for `LanguageSwitcher` only
 * verifies that the segmented control toggles, and the registry unit test
 * only verifies the dictionary lookup. This test exercises the full
 * "user clicks → consumer component re-reads microcopy" path.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import LanguageSwitcher from "../components/languageSwitcher";
import { microcopy } from "../constants/microcopy";
import {
    DEFAULT_LOCALE,
    getActiveLocaleCode,
    LanguageProvider,
    setActiveLocale
} from "../i18n";

/**
 * A consumer that reads from the static `microcopy` proxy on every render.
 * The proxy lazily resolves against the current active dictionary, so the
 * displayed string must change as soon as the locale flips and the
 * subtree remounts.
 */
const MicrocopyConsumer = () => (
    <>
        <div data-testid="search-label">{microcopy.chips.search}</div>
        <div data-testid="manager-label">{microcopy.chips.manager}</div>
        <div data-testid="active-locale">{getActiveLocaleCode()}</div>
    </>
);

const htmlLang = (): string =>
    document.documentElement.getAttribute("lang") ?? "";

const renderApp = () =>
    render(
        <LanguageProvider>
            <LanguageSwitcher />
            <MicrocopyConsumer />
        </LanguageProvider>
    );

describe("i18n locale switch integration", () => {
    beforeEach(() => {
        // Ensure each test starts from a clean English baseline.
        setActiveLocale(DEFAULT_LOCALE);
        window.localStorage.clear();
        document.documentElement.removeAttribute("lang");
    });

    afterEach(() => {
        setActiveLocale(DEFAULT_LOCALE);
        document.documentElement.removeAttribute("lang");
    });

    it("starts in the default locale and renders English microcopy", () => {
        renderApp();
        expect(screen.getByTestId("active-locale")).toHaveTextContent("en");
        expect(screen.getByTestId("search-label")).toHaveTextContent("Search");
        expect(screen.getByTestId("manager-label")).toHaveTextContent(
            "Manager"
        );
    });

    it("flips static microcopy reads to zh-CN when the user picks 中文", async () => {
        renderApp();

        fireEvent.click(screen.getByRole("radio", { name: "中文" }));

        // (1) Singleton tracks the new locale code synchronously.
        expect(getActiveLocaleCode()).toBe("zh-CN");
        expect(screen.getByTestId("active-locale")).toHaveTextContent("zh-CN");

        // (2) Static `microcopy.*` reads now resolve to the zh-CN strings —
        //     proves the LanguageProvider subtree remounted as designed.
        expect(screen.getByTestId("search-label")).toHaveTextContent("搜索");
        expect(screen.getByTestId("manager-label")).toHaveTextContent("负责人");

        // (3) `<html lang>` reflects the new locale (matters for AT and CSS).
        //     The DOM update happens inside a useEffect, so wait for it.
        await waitFor(() => expect(htmlLang()).toBe("zh-CN"));

        // (4) Choice is persisted so a reload preserves the locale.
        // Implementation persists under a known storage key — assert via
        // a value lookup so the test does not pin the key string.
        const storedValues = Object.values({ ...window.localStorage });
        expect(storedValues).toContain("zh-CN");
    });

    it("switches back to English when the user re-selects the English segment", async () => {
        renderApp();
        fireEvent.click(screen.getByRole("radio", { name: "中文" }));
        expect(getActiveLocaleCode()).toBe("zh-CN");

        fireEvent.click(screen.getByRole("radio", { name: "English" }));
        expect(getActiveLocaleCode()).toBe("en");
        expect(screen.getByTestId("search-label")).toHaveTextContent("Search");
        await waitFor(() => expect(htmlLang()).toBe("en"));
    });
});
