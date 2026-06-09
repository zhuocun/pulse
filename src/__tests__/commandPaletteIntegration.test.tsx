import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";

import App from "../App";
import { store } from "../store";

jest.mock("../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "http://localhost:8080/api/v1",
        aiBaseUrl: "",
        aiEnabled: false,
        aiUseLocalEngine: true
    }
}));

const installAntdMocks = () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        value: 800
    });
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: query.includes("min-width") ? true : false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const renderApp = () => {
    window.history.pushState({}, "Command palette", "/");
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <App />
            </QueryClientProvider>
        </Provider>
    );
};

describe("Command palette integration (App-level Cmd/Ctrl+K)", () => {
    beforeAll(() => {
        installAntdMocks();
    });

    const dispatchHotkey = async (overrides: KeyboardEventInit = {}) => {
        // Dispatch a real KeyboardEvent on window so the AppShell listener
        // (attached in useEffect) actually fires. user-event's `keyboard`
        // targets the focused element and would not bubble to window in
        // jsdom because the route stub has no focused interactive content.
        await act(async () => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "k",
                    ...overrides
                })
            );
        });
    };

    it("opens the palette when the user presses Cmd+K", async () => {
        renderApp();
        // No palette mounted yet — modal is hidden until the hotkey runs.
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

        await dispatchHotkey({ metaKey: true });

        await waitFor(() => {
            expect(screen.getByRole("combobox")).toBeInTheDocument();
        });
    });

    it("opens the palette when the user presses Ctrl+K", async () => {
        renderApp();
        await dispatchHotkey({ ctrlKey: true });
        await waitFor(() => {
            expect(screen.getByRole("combobox")).toBeInTheDocument();
        });
    });

    it("closes the palette when the user presses Esc", async () => {
        renderApp();
        await dispatchHotkey({ ctrlKey: true });
        const combobox = await screen.findByRole("combobox");
        expect(combobox).toBeInTheDocument();
        const user = userEvent.setup();
        await user.keyboard("{Escape}");
        await waitFor(() => {
            expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
        });
    });

    it("opens the palette when the commandPalette:open custom event fires", async () => {
        renderApp();
        // Other surfaces (help menu, deep link) can request the palette by
        // dispatching this custom event — no need to thread state through
        // the whole tree.
        await act(async () => {
            window.dispatchEvent(new CustomEvent("commandPalette:open"));
        });
        await waitFor(() => {
            expect(screen.getByRole("combobox")).toBeInTheDocument();
        });
    });
});
