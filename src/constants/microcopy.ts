/**
 * Centralized, locale-aware microcopy proxy.
 *
 * Importing `microcopy` from here is the single canonical way to read a
 * user-visible string. Each access (e.g. `microcopy.actions.cancel`) is
 * forwarded through a Proxy to the currently active dictionary that lives
 * in `src/i18n/active.ts`, so the same component code renders the right
 * language without any per-component refactor.
 *
 * The English literal (the structural baseline that every other locale
 * must match) lives in `src/i18n/locales/en.ts` — that file is also the
 * Proxy's default fallback, the `Dictionary` type derivation point, and
 * the seed for `i18n/active.ts`. Keeping the literal there breaks an
 * otherwise-circular import: `microcopy.ts` → `i18n/active.ts` →
 * `i18n/locales/en.ts` (no edges back).
 *
 * The exported `microcopy` symbol is typed as `typeof enSource` so call
 * sites keep their literal autocomplete (`microcopy.actions.editTask`
 * still has a known shape) and existing strict tests keep compiling.
 */
import { getActiveDictionary } from "../i18n/active";
import { enSource } from "../i18n/locales/en";

/**
 * Re-exported so consumers that only need the type (the i18n test
 * harness, locale dictionaries, future formatters) don't need to know
 * where the literal physically lives.
 */
export { enSource };

/**
 * Walks the active dictionary along `path` (e.g. `["ai", "confidenceBands"]`)
 * and returns the resolved sub-tree, or `undefined` if any segment is
 * missing. Resolved at access time (not bound at module load) so language
 * switches take effect on the very next read.
 */
const resolve = (path: readonly string[]): unknown =>
    path.reduce<unknown>(
        (acc, segment) =>
            acc != null && typeof acc === "object"
                ? (acc as Record<string, unknown>)[segment]
                : undefined,
        getActiveDictionary() as unknown
    );

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Returns a Proxy that lazily forwards every read to the active dictionary.
 * Non-object values (strings, numbers, arrays) are returned as-is; nested
 * objects get a sub-proxy so the same dynamic-resolution applies all the
 * way down. We also implement the `has`, `ownKeys`, and
 * `getOwnPropertyDescriptor` traps so `Object.entries(microcopy.X)` —
 * used by the i18n test harness — works against whichever dictionary is
 * active at iteration time.
 */
const makeProxy = (path: readonly string[]): unknown =>
    new Proxy(Object.create(null) as object, {
        get(_target, key) {
            if (typeof key !== "string") return undefined;
            const value = resolve([...path, key]);
            return isPlainObject(value) ? makeProxy([...path, key]) : value;
        },
        has(_target, key) {
            if (typeof key !== "string") return false;
            const parent = resolve(path);
            return isPlainObject(parent) && key in parent;
        },
        ownKeys() {
            const parent = resolve(path);
            return isPlainObject(parent) ? Reflect.ownKeys(parent) : [];
        },
        getOwnPropertyDescriptor(_target, key) {
            if (typeof key !== "string") return undefined;
            const parent = resolve(path);
            if (!isPlainObject(parent) || !(key in parent)) return undefined;
            const raw = parent[key];
            // `Object.entries` reads the descriptor's `value` directly, so we
            // surface a sub-proxy for nested objects to keep dynamic
            // resolution all the way down. `configurable: true` is required
            // because the underlying object may change between reads when
            // the active locale switches.
            return {
                value: isPlainObject(raw) ? makeProxy([...path, key]) : raw,
                writable: false,
                enumerable: true,
                configurable: true
            };
        }
    });

export const microcopy = makeProxy([]) as typeof enSource;

/** Coerces a microcopy leaf (or other unknown) to a string for `.replace` / ARIA. */
export const microcopyString = (value: unknown): string =>
    typeof value === "string" ? value : String(value ?? "");
