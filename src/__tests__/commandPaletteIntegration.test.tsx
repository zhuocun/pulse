import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

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

// Stub the heavy route children — we only care that the AppShell mounts
// the CommandPalette and the Cmd/Ctrl+K hotkey opens it. Each route
// renders a tiny placeholder so React Router can resolve them without
// pulling in pages, providers, or icons that drag in big test setup.
jest.mock("../routes", () => {
    const React = jest.requireActual("react");
    const dummy = (label: string) =>
        React.createElement("div", { "data-testid": `route-${label}` }, label);
    return {
        __esModule: true,
        default: [
            { path: "/", element: dummy("home") },
            { path: "*", element: dummy("anything") }
        ]
    };
});

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
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/"]}>
                    <App />
                </MemoryRouter>
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
