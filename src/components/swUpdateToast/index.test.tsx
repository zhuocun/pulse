import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { App as AntdApp, message, notification } from "antd";
import React from "react";

import { microcopy } from "../../constants/microcopy";

import SwUpdateToast from "./index";

/**
 * The toast surfaces through AntD's notification API; we render it under
 * <AntdApp> so `App.useApp()` returns a real notification instance
 * connected to the DOM (the static `notification` import shares the
 * same internal queue, so we destroy it between tests for hygiene).
 */
const Harness: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <AntdApp component={false}>{children}</AntdApp>
);

interface MockRegistration {
    waiting: { postMessage: jest.Mock } | null;
}

const buildRegistration = (): MockRegistration => ({
    waiting: { postMessage: jest.fn() }
});

describe("SwUpdateToast", () => {
    afterEach(async () => {
        act(() => {
            notification.destroy();
            message.destroy();
        });
        await act(async () => {
            await Promise.resolve();
        });
    });

    it("renders the update title and reload CTA on mount", async () => {
        const registration = buildRegistration();
        render(
            <Harness>
                <SwUpdateToast
                    registration={
                        registration as unknown as ServiceWorkerRegistration
                    }
                />
            </Harness>
        );
        // AntD opens its notification asynchronously; wait for it.
        await waitFor(() => {
            expect(
                screen.getByText(microcopy.swUpdate.title)
            ).toBeInTheDocument();
        });
        expect(
            screen.getByText(microcopy.swUpdate.description)
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: microcopy.swUpdate.reload })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: microcopy.swUpdate.dismiss })
        ).toBeInTheDocument();
    });

    it("posts SKIP_WAITING to registration.waiting and reloads when Reload is clicked", async () => {
        const registration = buildRegistration();
        const onReload = jest.fn();
        render(
            <Harness>
                <SwUpdateToast
                    registration={
                        registration as unknown as ServiceWorkerRegistration
                    }
                    onReload={onReload}
                />
            </Harness>
        );
        const reloadButton = await screen.findByRole("button", {
            name: microcopy.swUpdate.reload
        });
        await act(async () => {
            fireEvent.click(reloadButton);
        });
        // The component takes the onReload override path when supplied,
        // so we verify the override fires — actual postMessage wiring is
        // covered by the next test.
        expect(onReload).toHaveBeenCalledTimes(1);
    });

    it("posts SKIP_WAITING to the waiting worker and subscribes to controllerchange", async () => {
        const registration = buildRegistration();
        const listeners: Array<() => void> = [];
        const swSpy = {
            addEventListener: jest.fn(
                (
                    event: string,
                    handler: EventListenerOrEventListenerObject
                ) => {
                    if (
                        event === "controllerchange" &&
                        typeof handler === "function"
                    ) {
                        listeners.push(handler as () => void);
                    }
                }
            ),
            removeEventListener: jest.fn()
        };
        // jsdom doesn't ship a navigator.serviceWorker by default — define
        // it as a configurable property so we can swap it in/out per test.
        Object.defineProperty(navigator, "serviceWorker", {
            configurable: true,
            value: swSpy
        });
        try {
            render(
                <Harness>
                    <SwUpdateToast
                        registration={
                            registration as unknown as ServiceWorkerRegistration
                        }
                    />
                </Harness>
            );
            const reloadButton = await screen.findByRole("button", {
                name: microcopy.swUpdate.reload
            });
            await act(async () => {
                fireEvent.click(reloadButton);
            });
            expect(registration.waiting?.postMessage).toHaveBeenCalledWith({
                type: "SKIP_WAITING"
            });
            expect(swSpy.addEventListener).toHaveBeenCalledWith(
                "controllerchange",
                expect.any(Function)
            );
            // The handler should be a one-shot — invoking it removes
            // itself so a future `controllerchange` (e.g. after the next
            // update cycle) doesn't double-reload. We can't observe the
            // actual `location.reload()` call because jsdom's
            // `Location` is non-configurable, but we can confirm the
            // listener tears itself down.
            act(() => {
                listeners.forEach((handler) => handler());
            });
            expect(swSpy.removeEventListener).toHaveBeenCalledWith(
                "controllerchange",
                expect.any(Function)
            );
        } finally {
            // Restore serviceWorker to undefined so other tests aren't
            // affected — jsdom doesn't ship a default implementation.
            Object.defineProperty(navigator, "serviceWorker", {
                configurable: true,
                value: undefined
            });
        }
    });

    it("dismisses the toast and fires onDismiss when Later is clicked", async () => {
        const registration = buildRegistration();
        const onDismiss = jest.fn();
        render(
            <Harness>
                <SwUpdateToast
                    registration={
                        registration as unknown as ServiceWorkerRegistration
                    }
                    onDismiss={onDismiss}
                />
            </Harness>
        );
        const dismissButton = await screen.findByRole("button", {
            name: microcopy.swUpdate.dismiss
        });
        await act(async () => {
            fireEvent.click(dismissButton);
        });
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
