// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "util";

if (typeof window !== "undefined") {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: jest.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn()
        }))
    });
}

type MessagePortCallback = ((event: { data: unknown }) => void) | null;

class TestMessagePort {
    onmessage: MessagePortCallback = null;

    private target: TestMessagePort | null = null;

    addEventListener(_type: "message", listener: MessagePortCallback) {
        this.onmessage = listener;
    }

    close() {
        this.onmessage = null;
        this.target = null;
    }

    dispatchEvent() {
        return true;
    }

    link(target: TestMessagePort) {
        this.target = target;
    }

    postMessage(data: unknown) {
        window.setTimeout(() => {
            this.target?.onmessage?.({ data });
        }, 0);
    }

    removeEventListener() {
        this.onmessage = null;
    }

    start() {
        return undefined;
    }
}

class TestMessageChannel {
    port1 = new TestMessagePort();

    port2 = new TestMessagePort();

    constructor() {
        this.port1.link(this.port2);
        this.port2.link(this.port1);
    }
}

Object.defineProperty(globalThis, "TextEncoder", {
    configurable: true,
    value: TextEncoder
});

Object.defineProperty(globalThis, "TextDecoder", {
    configurable: true,
    value: TextDecoder
});

Object.defineProperty(globalThis, "MessageChannel", {
    configurable: true,
    value: TestMessageChannel
});

Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: jest.fn(),
    writable: true
});

if (typeof window !== "undefined") {
    const getComputedStyle = window.getComputedStyle.bind(window);

    Object.defineProperty(window, "getComputedStyle", {
        configurable: true,
        value: (element: Element) => getComputedStyle(element)
    });
}

Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserver {
        disconnect() {
            return undefined;
        }
        observe() {
            return undefined;
        }
        unobserve() {
            return undefined;
        }
    }
});

// Clear cookies between tests so the new auth-token cookie fallback
// (see `src/utils/tokenStorage.ts`) does not leak a value from one
// test into the next. jsdom keeps `document.cookie` set across cases
// even when `localStorage.clear()` runs in a per-test `beforeEach`.
if (typeof afterEach === "function" && typeof document !== "undefined") {
    afterEach(() => {
        try {
            const cookies = document.cookie;
            if (!cookies) return;
            for (const part of cookies.split(";")) {
                const name = part.split("=")[0]?.trim();
                if (name) {
                    document.cookie = `${name}=; Path=/; Max-Age=0`;
                }
            }
        } catch {
            // Some isolated test envs disable `document.cookie`; ignore.
        }
    });
}

// Reset the in-flight API dedup registry between tests. The `api()`
// helper coalesces concurrent identical GET / HEAD calls onto a single
// fetch and self-cleans on settle, but a test that mocks fetch with
// a `new Promise(...)` it never resolves leaves the entry pinned;
// the next test's identical call would silently reuse the dead promise.
if (typeof afterEach === "function") {
    afterEach(() => {
        // Lazy require — the module is the same singleton seen by app
        // code, so the registry is the one that needs clearing.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("./utils/hooks/useApi") as {
            resetInFlightApiCallsForTests?: () => void;
        };
        mod.resetInFlightApiCallsForTests?.();
    });
}
