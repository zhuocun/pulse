import { useCallback, useEffect, useMemo, useState } from "react";

import type { TriageNudge } from "../../interfaces/agent";

export interface NudgeEntry {
    nudge: TriageNudge;
    receivedAt: number;
}

/** Maximum active nudges per board (PRD AC-V14). */
export const NUDGE_INBOX_MAX = 5;
/** Auto-expire entries older than 4 hours (PRD AC-V14). */
export const NUDGE_EXPIRY_MS = 4 * 60 * 60 * 1000;
/** Periodic prune cadence; bounded so a stale entry can't linger past a minute. */
export const NUDGE_PRUNE_INTERVAL_MS = 60 * 1000;

/**
 * Apply inbox rules when a new nudge arrives:
 *   1. drop expired entries;
 *   2. drop any prior entry matching `(kind, project_id)` so the newer
 *      one supersedes it;
 *   3. prepend the incoming entry (newest first);
 *   4. cap at {@link NUDGE_INBOX_MAX}.
 * Pure for unit-testability.
 */
export const reduceNudgeInbox = (
    prev: NudgeEntry[],
    incoming: TriageNudge,
    now: number = Date.now()
): NudgeEntry[] => {
    const fresh = prev.filter(
        (entry) =>
            now - entry.receivedAt < NUDGE_EXPIRY_MS &&
            !(
                entry.nudge.kind === incoming.kind &&
                entry.nudge.project_id === incoming.project_id
            )
    );
    return [{ nudge: incoming, receivedAt: now }, ...fresh].slice(
        0,
        NUDGE_INBOX_MAX
    );
};

interface UseNudgeInboxResult {
    nudges: TriageNudge[];
    pushNudge: (nudge: TriageNudge) => void;
    dismissNudge: (nudgeId: string) => void;
    resetNudges: () => void;
}

export const useNudgeInbox = (): UseNudgeInboxResult => {
    const [nudgeEntries, setNudgeEntries] = useState<NudgeEntry[]>([]);

    const pushNudge = useCallback((incoming: TriageNudge) => {
        setNudgeEntries((prev) => reduceNudgeInbox(prev, incoming));
    }, []);

    const dismissNudge = useCallback((nudgeId: string) => {
        setNudgeEntries((prev) => {
            const next = prev.filter(
                (entry) => entry.nudge.nudge_id !== nudgeId
            );
            return next.length === prev.length ? prev : next;
        });
    }, []);

    const resetNudges = useCallback(() => {
        setNudgeEntries([]);
    }, []);

    useEffect(() => {
        const tick = () => {
            const now = Date.now();
            setNudgeEntries((prev) => {
                const fresh = prev.filter(
                    (entry) => now - entry.receivedAt < NUDGE_EXPIRY_MS
                );
                return fresh.length === prev.length ? prev : fresh;
            });
        };
        const id = setInterval(tick, NUDGE_PRUNE_INTERVAL_MS);
        return () => clearInterval(id);
    }, []);

    const nudges = useMemo<TriageNudge[]>(
        () => nudgeEntries.map((entry) => entry.nudge),
        [nudgeEntries]
    );

    return { nudges, pushNudge, dismissNudge, resetNudges };
};
