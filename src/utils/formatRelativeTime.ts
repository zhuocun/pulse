/**
 * Shared relative-time formatter.
 *
 * Four surfaces (the Inbox page, the activity-feed drawer, the AI
 * activity log, and the Copilot brief tab) historically each carried a
 * byte-identical copy of this just-now / N-minutes / N-hours / N-days
 * algorithm — they differed ONLY in which i18n namespace they read the
 * copy from (`activityFeed.relative*`, `aiActivityLog.relative*`,
 * `brief.relative*`) and whether they wrapped that read in the
 * `microcopyString` coercion. To keep every call site's exact rendered
 * output AND locale-reactivity, the formatter is parameterized on the
 * ALREADY-RESOLVED copy: the caller reads its own `microcopy.<ns>.*`
 * leaves (through the locale-aware Proxy, optionally via
 * `microcopyString`) and hands the resolved `strings` in. The Proxy read
 * still happens at the call site on every render, so language switches
 * propagate identically to the inlined copies they replace.
 *
 * `{count}` interpolation for the plural forms stays here so the
 * substitution rule lives in exactly one place.
 */

/**
 * The seven resolved relative-time strings a caller supplies. `minutes`,
 * `hours`, and `days` are the plural templates that contain a literal
 * `{count}` placeholder; the singular / "just now" forms are used
 * verbatim.
 */
export interface RelativeTimeStrings {
    justNow: string;
    oneMinute: string;
    minutes: string;
    oneHour: string;
    hours: string;
    oneDay: string;
    days: string;
}

/**
 * Formats the elapsed span between `thenMs` and `nowMs` as a localized
 * relative-time label. Pure: identical inputs always yield identical
 * output, with no clock or i18n reads of its own.
 *
 * Thresholds (kept byte-for-byte from the original inlined copies):
 *   < 30 s            → justNow
 *   < 90 s            → oneMinute
 *   minutes < 60      → minutes (with {count})
 *   hours   < 24      → oneHour (count 1) | hours (with {count})
 *   otherwise         → oneDay  (count 1) | days  (with {count})
 *
 * Negative spans (a `then` in the future) clamp to 0 → "just now",
 * matching the original `Math.max(0, …)` guard.
 */
export const formatRelativeTime = (
    thenMs: number,
    nowMs: number,
    strings: RelativeTimeStrings
): string => {
    const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
    if (seconds < 30) return strings.justNow;
    if (seconds < 90) return strings.oneMinute;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        return strings.minutes.replace("{count}", String(minutes));
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return hours === 1
            ? strings.oneHour
            : strings.hours.replace("{count}", String(hours));
    const days = Math.round(hours / 24);
    return days === 1
        ? strings.oneDay
        : strings.days.replace("{count}", String(days));
};
