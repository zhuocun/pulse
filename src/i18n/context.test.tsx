import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { getActiveLocaleCode, setActiveLocale } from "./active";
import { LanguageProvider, useLocale, useTranslation } from "./context";

const STORAGE_KEY = "pulse.locale";

const LocaleProbe = () => {
    const { locale, availableLocales, setLocale } = useLocale();
    const dict = useTranslation();
    return (
        <div>
            <span data-testid="locale">{locale}</span>
            <span data-testid="cancel">{dict.actions.cancel}</span>
            <span data-testid="available">
                {availableLocales.map((entry) => entry.code).join(",")}
            </span>
            <button type="button" onClick={() => setLocale("zh-CN")}>
                zh
            </button>
            <button type="button" onClick={() => setLocale("en")}>
                en
            </button>
        </div>
    );
};

const renderWithProvider = (children: ReactNode = <LocaleProbe />) =>
    render(<LanguageProvider>{children}</LanguageProvider>);

describe("LanguageProvider", () => {
    afterEach(() => {
        window.localStorage.clear();
        setActiveLocale("en");
        document.documentElement.removeAttribute("lang");
    });

    it("seeds with the persisted locale and surfaces the available locales", () => {
        window.localStorage.setItem(STORAGE_KEY, "zh-CN");
        renderWithProvider();
        expect(screen.getByTestId("locale")).toHaveTextContent("zh-CN");
        expect(screen.getByTestId("available")).toHaveTextContent("en,zh-CN");
    });

    it("setLocale switches the active dictionary, singleton, and html lang", () => {
        renderWithProvider();
        expect(screen.getByTestId("locale")).toHaveTextContent("en");
        const englishCancel = screen.getByTestId("cancel").textContent ?? "";

        act(() => {
            fireEvent.click(screen.getByRole("button", { name: "zh" }));
        });

        expect(screen.getByTestId("locale")).toHaveTextContent("zh-CN");
        // After flipping, the cancel label is rendered from the Chinese
        // dictionary, not the English one.
        expect(screen.getByTestId("cancel").textContent).not.toBe(
            englishCancel
        );
        expect(getActiveLocaleCode()).toBe("zh-CN");
        expect(document.documentElement.getAttribute("lang")).toBe("zh-CN");
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe("zh-CN");
    });

    it("calling setLocale with the current code is a no-op", () => {
        renderWithProvider();
        const before = screen.getByTestId("locale").textContent;
        act(() => {
            fireEvent.click(screen.getByRole("button", { name: "en" }));
        });
        expect(screen.getByTestId("locale").textContent).toBe(before);
    });

    it("useTranslation outside of a provider falls back to the default English dictionary", () => {
        // Render the probe without a surrounding provider — exercises the
        // default `createContext` value.
        render(<LocaleProbe />);
        expect(screen.getByTestId("locale")).toHaveTextContent("en");
        expect(screen.getByTestId("cancel").textContent).toBe("Cancel");
    });
});
