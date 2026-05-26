import {
    formatRelativeTime,
    type RelativeTimeStrings
} from "./formatRelativeTime";

/**
 * Sentinel copy. Each form is distinct so a test can assert exactly
 * which branch fired, and the plural templates carry the literal
 * `{count}` placeholder so we can prove the interpolation happens inside
 * the util (and only once per call).
 */
const STRINGS: RelativeTimeStrings = {
    justNow: "JUST_NOW",
    oneMinute: "ONE_MIN",
    minutes: "{count} MIN",
    oneHour: "ONE_HOUR",
    hours: "{count} HOURS",
    oneDay: "ONE_DAY",
    days: "{count} DAYS"
};

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** `now` anchor; `then = NOW - elapsedMs` drives the relative span. */
const NOW = 1_700_000_000_000;
const ago = (elapsedMs: number): string =>
    formatRelativeTime(NOW - elapsedMs, NOW, STRINGS);

describe("formatRelativeTime", () => {
    describe("threshold boundaries", () => {
        // The rounding makes the human-facing cutoffs sit a half-unit
        // past the raw constant: e.g. `seconds < 30` flips to "1 min"
        // only once the rounded second count reaches 30, which a 29.5 s
        // span (Math.round → 30) crosses. Each row pins the exact span
        // either side of a branch edge.
        const cases: Array<[label: string, elapsedMs: number, want: string]> = [
            // just now: rounded seconds in [0, 30)
            ["zero elapsed", 0, "JUST_NOW"],
            ["29 s (rounds to 29)", 29 * SEC, "JUST_NOW"],
            ["29.49 s (rounds to 29)", 29.49 * SEC, "JUST_NOW"],
            // one minute: rounded seconds in [30, 90)
            ["29.5 s (rounds to 30)", 29.5 * SEC, "ONE_MIN"],
            ["30 s", 30 * SEC, "ONE_MIN"],
            ["89 s (rounds to 89)", 89 * SEC, "ONE_MIN"],
            ["89.49 s (rounds to 89)", 89.49 * SEC, "ONE_MIN"],
            // N minutes: minutes = round(seconds/60), in [2, 60)
            //   90 s → 90 rounded s → 2 min (round(90/60)=2)
            ["89.5 s (rounds to 90 s → 2 min)", 89.5 * SEC, "2 MIN"],
            ["90 s → 2 min", 90 * SEC, "2 MIN"],
            ["2 min exactly", 2 * MIN, "2 MIN"],
            ["59 min", 59 * MIN, "59 MIN"],
            ["59 min 29 s (rounds to 59)", 59 * MIN + 29 * SEC, "59 MIN"],
            // one hour: hours = round(minutes/60) === 1
            //   59 min 30 s → 60 min → round(60/60)=1 hour
            ["59 min 30 s → 60 min → 1 hour", 59 * MIN + 30 * SEC, "ONE_HOUR"],
            ["60 min → 1 hour", 60 * MIN, "ONE_HOUR"],
            ["89 min → round 1 hour", 89 * MIN, "ONE_HOUR"],
            // N hours: hours in [2, 24)
            ["90 min → 2 hours", 90 * MIN, "2 HOURS"],
            ["2 hours exactly", 2 * HOUR, "2 HOURS"],
            ["23 hours", 23 * HOUR, "23 HOURS"],
            ["23 h 29 min → round 23 hours", 23 * HOUR + 29 * MIN, "23 HOURS"],
            // one day: days = round(hours/24) === 1
            //   23 h 30 min → 24 h → round(24/24)=1 day
            ["23 h 30 min → 24 h → 1 day", 23 * HOUR + 30 * MIN, "ONE_DAY"],
            ["24 hours → 1 day", 24 * HOUR, "ONE_DAY"],
            ["35 hours → round 1 day", 35 * HOUR, "ONE_DAY"],
            // N days: days in [2, ...)
            ["36 hours → 2 days", 36 * HOUR, "2 DAYS"],
            ["2 days exactly", 2 * DAY, "2 DAYS"],
            ["10 days", 10 * DAY, "10 DAYS"]
        ];

        it.each(cases)("%s → %s", (_label, elapsedMs, want) => {
            expect(ago(elapsedMs)).toBe(want);
        });
    });

    describe("{count} interpolation", () => {
        it("substitutes the minute count into the plural template", () => {
            expect(ago(5 * MIN)).toBe("5 MIN");
            expect(ago(42 * MIN)).toBe("42 MIN");
        });

        it("substitutes the hour count into the plural template", () => {
            expect(ago(3 * HOUR)).toBe("3 HOURS");
            expect(ago(12 * HOUR)).toBe("12 HOURS");
        });

        it("substitutes the day count into the plural template", () => {
            expect(ago(4 * DAY)).toBe("4 DAYS");
            expect(ago(30 * DAY)).toBe("30 DAYS");
        });

        it("replaces only the first {count} occurrence (String.replace semantics)", () => {
            // Mirrors the original inlined `.replace("{count}", …)`, which
            // is a single-substitution call — a template with two
            // placeholders would only fill the first.
            const doubled: RelativeTimeStrings = {
                ...STRINGS,
                minutes: "{count} and {count}"
            };
            expect(formatRelativeTime(NOW - 5 * MIN, NOW, doubled)).toBe(
                "5 and {count}"
            );
        });
    });

    describe("clamping and ordering", () => {
        it("clamps a future `then` to just now (negative span → 0)", () => {
            expect(formatRelativeTime(NOW + 10 * MIN, NOW, STRINGS)).toBe(
                "JUST_NOW"
            );
        });

        it("is pure — identical inputs yield identical output", () => {
            const a = formatRelativeTime(NOW - 7 * HOUR, NOW, STRINGS);
            const b = formatRelativeTime(NOW - 7 * HOUR, NOW, STRINGS);
            expect(a).toBe(b);
            expect(a).toBe("7 HOURS");
        });
    });
});
