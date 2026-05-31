/**
 * Per-device acknowledgement of "Board Copilot is connected to a remote
 * AI service" (Optimization Plan §3 P0-2).
 *
 * The existing `EngineModeTag` and `CopilotPrivacyPopover` make remote
 * mode discoverable, but neither requires explicit user acknowledgement
 * before the first remote request. This module provides the storage layer
 * for a one-shot consent banner — surfaces read `hasAcknowledgedRemoteAi`
 * to decide whether to render the banner, then call
 * `acknowledgeRemoteAi` when the user dismisses it.
 *
 * Acknowledgement is keyed by the configured AI base URL so a workspace
 * pointed at a different remote service prompts the user again. Falls back
 * to in-memory state when `localStorage` is unavailable (Safari private
 * mode, older browsers, server-side render).
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY_PREFIX = "boardCopilot:remoteConsent:";
const memoryState = new Map<string, boolean>();
const listeners = new Set<() => void>();

const emitConsentChange = (): void => {
    listeners.forEach((listener) => listener());
};

const subscribeRemoteAiConsent = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const storageKeyFor = (baseUrl: string): string => {
    const trimmed = (baseUrl || "").trim();
    return `${STORAGE_KEY_PREFIX}${trimmed || "default"}`;
};

const safeReadStorage = (key: string): boolean => {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem(key) === "1";
    } catch {
        return false;
    }
};

const safeWriteStorage = (key: string): void => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, "1");
    } catch {
        /* private mode or quota exceeded — fall back to memory */
    }
};

export const hasAcknowledgedRemoteAi = (baseUrl: string): boolean => {
    const key = storageKeyFor(baseUrl);
    if (memoryState.get(key)) return true;
    return safeReadStorage(key);
};

export const acknowledgeRemoteAi = (baseUrl: string): void => {
    const key = storageKeyFor(baseUrl);
    memoryState.set(key, true);
    safeWriteStorage(key);
    emitConsentChange();
};

export const useRemoteAiConsent = (baseUrl: string): boolean =>
    useSyncExternalStore(
        subscribeRemoteAiConsent,
        () => hasAcknowledgedRemoteAi(baseUrl),
        () => false
    );

/** Test-only helper: reset both memory and storage state. */
export const resetRemoteAiConsentForTests = (baseUrl?: string): void => {
    if (baseUrl !== undefined) {
        memoryState.delete(storageKeyFor(baseUrl));
        if (typeof window !== "undefined") {
            try {
                window.localStorage.removeItem(storageKeyFor(baseUrl));
            } catch {
                /* ignore */
            }
        }
        emitConsentChange();
        return;
    }
    memoryState.clear();
    if (typeof window !== "undefined") {
        try {
            for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
                const key = window.localStorage.key(i);
                if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
                    window.localStorage.removeItem(key);
                }
            }
        } catch {
            /* ignore */
        }
    }
    emitConsentChange();
};
