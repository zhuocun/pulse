import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";

import CopilotMenu from "./index";

const installAntdBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });

    class ResizeObserverMock {
        observe = jest.fn();

        unobserve = jest.fn();

        disconnect = jest.fn();
    }

    Object.defineProperty(window, "ResizeObserver", {
        writable: true,
        value: ResizeObserverMock
    });
};

const setup = (
    overrides: Partial<React.ComponentProps<typeof CopilotMenu>> = {}
) => {
    const onAsk = jest.fn();
    const onBrief = jest.fn();
    const onProjectOff = jest.fn();
    render(
        <CopilotMenu
            inboxUnread={0}
            onAsk={onAsk}
            onBrief={onBrief}
            onProjectOff={onProjectOff}
            {...overrides}
        />
    );
    return { onAsk, onBrief, onProjectOff };
};

const openMenu = async () => {
    fireEvent.click(
        screen.getByRole("button", { name: /board copilot menu/i })
    );
};

describe("CopilotMenu", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    it("runs the Ask action when the primary Copilot button is clicked", () => {
        const { onAsk, onBrief, onProjectOff } = setup();
        fireEvent.click(screen.getByRole("button", { name: /^copilot$/i }));
        expect(onAsk).toHaveBeenCalledTimes(1);
        expect(onBrief).not.toHaveBeenCalled();
        expect(onProjectOff).not.toHaveBeenCalled();
    });

    it("opens the Brief drawer from the menu", async () => {
        const { onBrief } = setup();
        await openMenu();
        fireEvent.click(
            await screen.findByRole("menuitem", { name: /board brief/i })
        );
        expect(onBrief).toHaveBeenCalledTimes(1);
    });

    it("opens chat from the Ask menu item", async () => {
        const { onAsk } = setup();
        await openMenu();
        fireEvent.click(
            await screen.findByRole("menuitem", { name: /ask copilot/i })
        );
        expect(onAsk).toHaveBeenCalledTimes(1);
    });

    it("disables Project AI from the menu", async () => {
        const { onProjectOff } = setup();
        await openMenu();
        fireEvent.click(
            await screen.findByRole("menuitem", { name: /project ai off/i })
        );
        expect(onProjectOff).toHaveBeenCalledTimes(1);
    });

    it("surfaces the unread badge with the supplied accessible label", () => {
        setup({ inboxUnread: 3, unreadAriaLabel: "3 unread Copilot nudges" });
        const badge = screen.getByTestId("copilot-launcher-badge");
        expect(badge.getAttribute("aria-label")).toBe(
            "3 unread Copilot nudges"
        );
    });
});
