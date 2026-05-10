import { useEffect, useState } from "react";

/**
 * Delays turning a boolean `true`, but never delays turning it `false`.
 *
 * This is used for loading affordances that should avoid a flash on very fast
 * responses. For example, using the default 250 ms delay means a spinner only
 * appears when loading is sustained long enough to be visually meaningful.
 *
 * Behavior contract:
 * - When `flag` becomes `true`, the returned value flips to `true` after
 *   `delayMs`.
 * - When `flag` becomes `false`, the returned value flips to `false`
 *   immediately.
 * - If `flag` toggles back to `false` before the delay elapses, the pending
 *   timer is cleared and the returned value never becomes `true`.
 *
 * @param flag Source boolean to delay.
 * @param delayMs Delay in milliseconds before returning `true`. Defaults to
 * `250`.
 * @returns A throttled boolean intended for rendering delayed loading UI.
 */
const useDelayedFlag = (flag: boolean, delayMs = 250): boolean => {
    const [delayed, setDelayed] = useState(false);

    useEffect(() => {
        if (!flag) {
            setDelayed(false);
            return;
        }
        const timer = window.setTimeout(() => setDelayed(true), delayMs);
        return () => {
            window.clearTimeout(timer);
        };
    }, [flag, delayMs]);

    return delayed;
};

export default useDelayedFlag;
