import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { type AgentPingResult, pingAgent } from "../ai/agentHealth";

export type AgentHealthStatus = "ok" | "degraded" | "offline";

export interface UseAgentHealthState {
    status: AgentHealthStatus;
    latencyMs: number;
    lastChecked: number | null;
    ready: boolean;
    realProviderReady: boolean;
    provider: string | null;
    model: string | null;
    stubMode: boolean;
    issues: readonly string[];
    warnings: readonly string[];
    providerConnectivity?: AgentPingResult["providerConnectivity"];
}

const DEFAULT_INTERVAL_MS = 30_000;
/** Latency above this is "degraded" even when the response was OK. */
const DEGRADED_THRESHOLD_MS = 1500;

const classify = (result: AgentPingResult): AgentHealthStatus => {
    if (!result.ready) return "offline";
    if (!result.ok) return "degraded";
    if (result.warnings.length > 0) return "degraded";
    const { latencyMs } = result;
    if (latencyMs < 0 || latencyMs > DEGRADED_THRESHOLD_MS) return "degraded";
    return "ok";
};

const PRE_PROBE_STATE: UseAgentHealthState = {
    status: "degraded",
    latencyMs: -1,
    lastChecked: null,
    ready: false,
    realProviderReady: false,
    provider: null,
    model: null,
    stubMode: false,
    issues: [],
    warnings: []
};
const OFFLINE_STATE: UseAgentHealthState = {
    status: "offline",
    latencyMs: -1,
    lastChecked: null,
    ready: false,
    realProviderReady: false,
    provider: null,
    model: null,
    stubMode: false,
    issues: [],
    warnings: []
};

/**
 * Singleton poller shared across every active `useAgentHealth` consumer
 * for the same `(baseUrl, intervalMs)` pair. Without this, mounting the
 * hook in both the page header and the AI chat drawer doubled the probes
 * against `/api/v1/health/ai?probe=true` (two independent timers ticking
 * at the same cadence with no coordination). Each consumer subscribes
 * with `useSyncExternalStore`; when the last subscriber unmounts the
 * timer is cleared and the entry is dropped so a stale Map can't pin
 * memory or restart with old state on the next mount.
 */
interface SharedHealthPoller {
    state: UseAgentHealthState;
    subscribers: Set<() => void>;
    controller: AbortController | null;
    timer: ReturnType<typeof setInterval> | null;
    baseUrl: string;
    intervalMs: number;
}

const sharedPollers = new Map<string, SharedHealthPoller>();

const pollerKey = (baseUrl: string, intervalMs: number) =>
    `${baseUrl}::${intervalMs}`;

const notifySubscribers = (poller: SharedHealthPoller) => {
    for (const subscriber of poller.subscribers) {
        subscriber();
    }
};

const probe = async (poller: SharedHealthPoller): Promise<void> => {
    if (poller.controller !== null) return;
    const controller = new AbortController();
    poller.controller = controller;
    try {
        const result = await pingAgent(poller.baseUrl, controller.signal);
        if (poller.controller !== controller) return;
        poller.state = {
            status: classify(result),
            latencyMs: result.latencyMs,
            lastChecked: Date.now(),
            ready: result.ready,
            realProviderReady: result.realProviderReady,
            provider: result.provider,
            model: result.model,
            stubMode: result.stubMode,
            issues: result.issues,
            warnings: result.warnings,
            ...(result.providerConnectivity
                ? { providerConnectivity: result.providerConnectivity }
                : {})
        };
        notifySubscribers(poller);
    } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
            if (poller.controller !== controller) return;
            poller.state = {
                status: "offline",
                latencyMs: -1,
                lastChecked: Date.now(),
                ready: false,
                realProviderReady: false,
                provider: null,
                model: null,
                stubMode: false,
                issues: [],
                warnings: []
            };
            notifySubscribers(poller);
        }
    } finally {
        if (poller.controller === controller) {
            poller.controller = null;
        }
    }
};

const startPoller = (poller: SharedHealthPoller) => {
    if (poller.timer !== null) return;
    void probe(poller);
    poller.timer = setInterval(() => {
        void probe(poller);
    }, poller.intervalMs);
};

const stopPoller = (poller: SharedHealthPoller, key: string) => {
    if (poller.timer !== null) {
        clearInterval(poller.timer);
        poller.timer = null;
    }
    poller.controller?.abort();
    poller.controller = null;
    sharedPollers.delete(key);
};

const subscribeToPoller = (
    baseUrl: string,
    intervalMs: number,
    onChange: () => void
): (() => void) => {
    const key = pollerKey(baseUrl, intervalMs);
    let poller = sharedPollers.get(key);
    if (!poller) {
        poller = {
            state: PRE_PROBE_STATE,
            subscribers: new Set<() => void>(),
            controller: null,
            timer: null,
            baseUrl,
            intervalMs
        };
        sharedPollers.set(key, poller);
    }
    poller.subscribers.add(onChange);
    if (poller.timer === null) {
        startPoller(poller);
    }
    return () => {
        const current = sharedPollers.get(key);
        if (!current) return;
        current.subscribers.delete(onChange);
        if (current.subscribers.size === 0) {
            stopPoller(current, key);
        }
    };
};

const getPollerSnapshot = (
    baseUrl: string,
    intervalMs: number
): UseAgentHealthState => {
    const poller = sharedPollers.get(pollerKey(baseUrl, intervalMs));
    return poller?.state ?? PRE_PROBE_STATE;
};

const noopUnsubscribe = () => {
    // No subscription when the hook is disabled.
};

/**
 * Poll `/api/v1/health/ai?probe=true` and expose availability status
 * (PRD §6.2). The hook is a no-op when `baseUrl` is empty (v1 fallback). It
 * cleans up on unmount and respects an optional polling interval.
 *
 * Multiple consumers with the same `(baseUrl, intervalMs)` pair share one
 * underlying poller — mounting the hook in both the header and the AI
 * chat drawer no longer doubles requests against the health endpoint.
 */
const useAgentHealth = (
    baseUrl: string = "",
    opts: { intervalMs?: number; enabled?: boolean; agentName?: string } = {}
): UseAgentHealthState => {
    const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    const enabled = opts.enabled !== false && baseUrl.length > 0;
    const agentName = opts.agentName ?? "unknown";

    /*
     * `useSyncExternalStore` re-subscribes whenever the subscribe function
     * identity changes. Wrap in `useCallback` so re-subscribing only
     * happens when the inputs that actually scope the poller change
     * (`baseUrl`, `interval`, `enabled`) instead of on every render.
     */
    const subscribe = useCallback(
        (onChange: () => void): (() => void) =>
            enabled
                ? subscribeToPoller(baseUrl, interval, onChange)
                : noopUnsubscribe,
        [baseUrl, interval, enabled]
    );
    const getSnapshot = useCallback(
        (): UseAgentHealthState =>
            enabled ? getPollerSnapshot(baseUrl, interval) : OFFLINE_STATE,
        [baseUrl, interval, enabled]
    );
    const state = useSyncExternalStore(
        subscribe,
        getSnapshot,
        () => OFFLINE_STATE
    );

    /**
     * Track the last status we fired AGENT_HEALTH_DEGRADED for so we only
     * emit once per transition into a degraded/offline state.
     * Null until the first real probe completes so the pre-probe synthetic
     * "degraded" initial state does not trigger the event. Kept per
     * consumer so each surface (header, chat drawer) reports its own
     * `agentName` in analytics; the underlying ping is still shared.
     */
    const lastFiredStatusRef = useRef<AgentHealthStatus | null>(null);

    // Fire AGENT_HEALTH_DEGRADED once per transition into degraded/offline,
    // but only after a real probe has completed (lastChecked !== null).
    useEffect(() => {
        const { status, lastChecked } = state;
        // Ignore the synthetic pre-probe state — wait for a real result.
        if (lastChecked === null) return;
        if (status === "degraded" || status === "offline") {
            if (lastFiredStatusRef.current !== status) {
                lastFiredStatusRef.current = status;
                track(ANALYTICS_EVENTS.AGENT_HEALTH_DEGRADED, {
                    status,
                    agentName
                });
            }
        } else {
            // Reset dedup ref when back to healthy so a future degradation
            // fires again.
            lastFiredStatusRef.current = null;
        }
    }, [agentName, state]);

    return state;
};

/**
 * Test-only: tear down every shared poller and clear cached state so a
 * fresh test starts from a blank slate.
 */
export const resetAgentHealthForTests = (): void => {
    for (const [key, poller] of sharedPollers) {
        stopPoller(poller, key);
    }
    sharedPollers.clear();
};

/** Test-only: how many active poller singletons currently exist. */
export const activeAgentHealthPollerCountForTests = (): number =>
    sharedPollers.size;

/** Test-only: how many subscribers a `(baseUrl, intervalMs)` poller has. */
export const agentHealthSubscriberCountForTests = (
    baseUrl: string,
    intervalMs: number
): number =>
    sharedPollers.get(pollerKey(baseUrl, intervalMs))?.subscribers.size ?? 0;

export default useAgentHealth;
