import { act, renderHook } from "@testing-library/react";

import type { TriageNudge } from "../../interfaces/agent";

import {
    NUDGE_EXPIRY_MS,
    NUDGE_INBOX_MAX,
    NUDGE_PRUNE_INTERVAL_MS,
    reduceNudgeInbox,
    useNudgeInbox
} from "./useNudgeInbox";

const buildNudge = (overrides: Partial<TriageNudge> = {}): TriageNudge => ({
    nudge_id: "n-1",
    kind: "load_imbalance",
    project_id: "p-1",
    summary: "Alice has 3 tasks",
    target_ids: ["t-1"],
    severity: "warn",
    ...overrides
});

describe("reduceNudgeInbox", () => {
    it("prepends an incoming nudge to an empty list", () => {
        const next = reduceNudgeInbox([], buildNudge(), 1_000);
        expect(next).toHaveLength(1);
        expect(next[0].nudge.nudge_id).toBe("n-1");
        expect(next[0].receivedAt).toBe(1_000);
    });

    it("drops a prior entry that matches (kind, project_id)", () => {
        const prev = [
            {
                nudge: buildNudge({ nudge_id: "old", summary: "old text" }),
                receivedAt: 0
            }
        ];
        const next = reduceNudgeInbox(prev, buildNudge({ nudge_id: "new" }), 1);
        expect(next).toHaveLength(1);
        expect(next[0].nudge.nudge_id).toBe("new");
    });

    it("keeps prior entries that target a different project even if the kind matches", () => {
        const prev = [
            {
                nudge: buildNudge({
                    nudge_id: "other-proj",
                    project_id: "p-2"
                }),
                receivedAt: 0
            }
        ];
        const next = reduceNudgeInbox(
            prev,
            buildNudge({ nudge_id: "p1-new" }),
            1
        );
        expect(next.map((e) => e.nudge.nudge_id)).toEqual([
            "p1-new",
            "other-proj"
        ]);
    });

    it("drops entries past the expiry window", () => {
        const prev = [
            {
                nudge: buildNudge({ nudge_id: "stale", project_id: "p-other" }),
                receivedAt: 0
            }
        ];
        const now = NUDGE_EXPIRY_MS + 1;
        const next = reduceNudgeInbox(
            prev,
            buildNudge({ nudge_id: "fresh" }),
            now
        );
        expect(next).toHaveLength(1);
        expect(next[0].nudge.nudge_id).toBe("fresh");
    });

    it(`caps the inbox at ${NUDGE_INBOX_MAX} entries`, () => {
        let inbox: ReturnType<typeof reduceNudgeInbox> = [];
        for (let i = 0; i < NUDGE_INBOX_MAX + 3; i += 1) {
            inbox = reduceNudgeInbox(
                inbox,
                buildNudge({
                    nudge_id: `n-${i}`,
                    project_id: `p-${i}`
                }),
                i + 1
            );
        }
        expect(inbox).toHaveLength(NUDGE_INBOX_MAX);
        // Newest first.
        expect(inbox[0].nudge.nudge_id).toBe(`n-${NUDGE_INBOX_MAX + 2}`);
    });
});

describe("useNudgeInbox", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it("starts empty", () => {
        const { result } = renderHook(() => useNudgeInbox());
        expect(result.current.nudges).toEqual([]);
    });

    it("pushNudge appends to the inbox", () => {
        const { result } = renderHook(() => useNudgeInbox());
        act(() => {
            result.current.pushNudge(buildNudge());
        });
        expect(result.current.nudges).toHaveLength(1);
        expect(result.current.nudges[0].nudge_id).toBe("n-1");
    });

    it("dismissNudge removes a nudge by id and is a no-op when not present", () => {
        const { result } = renderHook(() => useNudgeInbox());
        act(() => {
            result.current.pushNudge(buildNudge());
            result.current.pushNudge(
                buildNudge({ nudge_id: "n-2", project_id: "p-2" })
            );
        });
        const prevList = result.current.nudges;
        act(() => {
            result.current.dismissNudge("missing");
        });
        // Identity preserved when no removal happens — checks the early-out
        // path that compares lengths.
        expect(result.current.nudges).toBe(prevList);

        act(() => {
            result.current.dismissNudge("n-2");
        });
        expect(result.current.nudges).toHaveLength(1);
        expect(result.current.nudges[0].nudge_id).toBe("n-1");
    });

    it("resetNudges clears the inbox", () => {
        const { result } = renderHook(() => useNudgeInbox());
        act(() => {
            result.current.pushNudge(buildNudge());
        });
        expect(result.current.nudges).toHaveLength(1);
        act(() => {
            result.current.resetNudges();
        });
        expect(result.current.nudges).toEqual([]);
    });

    it("prunes expired entries via the interval ticker", () => {
        const baseTime = 1_000_000;
        jest.setSystemTime(baseTime);
        const { result } = renderHook(() => useNudgeInbox());
        act(() => {
            result.current.pushNudge(buildNudge());
        });
        expect(result.current.nudges).toHaveLength(1);

        // Advance past the expiry window, then tick the prune interval.
        jest.setSystemTime(baseTime + NUDGE_EXPIRY_MS + 1);
        act(() => {
            jest.advanceTimersByTime(NUDGE_PRUNE_INTERVAL_MS);
        });
        expect(result.current.nudges).toEqual([]);
    });
});
