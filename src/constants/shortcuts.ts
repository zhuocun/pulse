/**
 * Single source-of-truth keyboard-shortcut catalog (ui-todo §2.A.9, Phase 4
 * help, WCAG 3.2.6 Consistent Help).
 *
 * Every shortcut the app advertises lives here exactly once. The help dialog
 * (`src/components/shortcutHelp`) renders this list grouped by `scope`, and
 * `useShortcut` (`src/utils/hooks/useShortcut`) consumes the structured
 * `combo` so the documented keystroke and the wired-up handler cannot drift.
 *
 * `combo` is structured (not a pre-rendered string) so it can be BOTH matched
 * against a `KeyboardEvent` AND rendered as a sequence of `<kbd>` tokens.
 * Platform awareness (⌘ on mac vs Ctrl elsewhere) is resolved at render /
 * match time via `isMacLike()` so the catalog stays declarative.
 */
import { microcopy } from "./microcopy";
import { isMacLike } from "../utils/platform";

/**
 * A single key token inside a combo.
 *  - `mod` is the platform-aware command modifier (⌘ on mac, Ctrl elsewhere).
 *  - `key` is a literal key value matched case-insensitively against
 *    `KeyboardEvent.key` (e.g. "k", "?", "Escape").
 * A combo is an ordered list of segments; each segment is itself an ordered
 * list of tokens. A single-segment combo is a chord pressed together
 * (`Cmd+K`); a multi-segment combo is a sequence pressed in turn (`g p`).
 */
export interface ShortcutToken {
    /** Platform-aware command modifier (⌘ / Ctrl). */
    mod?: boolean;
    /** Literal key, matched case-insensitively against `event.key`. */
    key: string;
    /** Human label for the `<kbd>` when it differs from `key` (e.g. arrows). */
    label?: string;
}

export type ShortcutSegment = readonly ShortcutToken[];

export type ShortcutScope =
    "global" | "projectPage" | "board" | "taskCard" | "overlay";

export interface ShortcutEntry {
    /** Stable id; also the key into `microcopy.shortcuts.descriptions`. */
    id: string;
    /** Ordered segments. >1 segment = a typed sequence (chord), e.g. `g p`. */
    combo: readonly ShortcutSegment[];
    /** Grouping bucket for the help dialog. */
    scope: ShortcutScope;
}

/** Convenience builder for a one-segment combo. */
const chord = (...tokens: ShortcutToken[]): readonly ShortcutSegment[] => [
    tokens
];

/** Convenience builder for a multi-segment typed sequence (e.g. `g p`). */
const sequence = (...keys: string[]): readonly ShortcutSegment[] =>
    keys.map((key) => [{ key }]);

/**
 * The catalog. Order here is the order rows render within each scope group.
 * `id` doubles as the `microcopy.shortcuts.descriptions[id]` key, so adding a
 * shortcut means adding ONE entry here + ONE description key in BOTH locales.
 */
export const SHORTCUTS: readonly ShortcutEntry[] = [
    {
        id: "openCommandPalette",
        combo: chord({ mod: true, key: "k", label: "K" }),
        scope: "global"
    },
    {
        id: "openShortcutHelp",
        combo: chord({ key: "?", label: "?" }),
        scope: "global"
    },
    {
        id: "goToProjects",
        combo: sequence("g", "p"),
        scope: "global"
    },
    {
        id: "goToBoard",
        combo: sequence("g", "b"),
        scope: "projectPage"
    },
    {
        id: "createTask",
        combo: chord({ key: "c", label: "c" }),
        scope: "board"
    },
    {
        id: "editTask",
        combo: chord({ key: "e", label: "e" }),
        scope: "taskCard"
    },
    {
        id: "keyboardDragTask",
        // Space to lift / drop, arrows to move, Esc to cancel. Rendered as a
        // descriptive token sequence; the actual handlers live on the card
        // (`src/components/column`) and are intentionally NOT wired here.
        combo: [
            [
                { key: " ", label: "Space" },
                { key: "ArrowUp", label: "↑" },
                { key: "ArrowDown", label: "↓" },
                { key: "ArrowLeft", label: "←" },
                { key: "ArrowRight", label: "→" },
                { key: "Escape", label: "Esc" }
            ]
        ],
        scope: "taskCard"
    },
    {
        id: "closeOverlay",
        combo: chord({ key: "Escape", label: "Esc" }),
        scope: "overlay"
    }
];

/** Lookup a catalog entry by id (throws nothing; returns undefined if absent). */
export const getShortcut = (id: string): ShortcutEntry | undefined =>
    SHORTCUTS.find((entry) => entry.id === id);

/**
 * The structured combo for opening the command palette — exported so the
 * palette's `Cmd/Ctrl+K` handler can reference the catalog rather than
 * re-declaring the keystroke. (See `src/App.tsx` / commandPalette.)
 */
export const COMMAND_PALETTE_COMBO =
    getShortcut("openCommandPalette")!.combo[0];

/**
 * Resolve a single token to its display string, honoring the platform for the
 * command modifier (⌘ on mac, Ctrl elsewhere).
 */
export const renderToken = (token: ShortcutToken): string => {
    const parts: string[] = [];
    if (token.mod) {
        parts.push(isMacLike() ? "⌘" : "Ctrl");
    }
    parts.push(token.label ?? token.key);
    return parts.join(" ");
};

/** The human description for an entry, read from the active locale. */
export const describeShortcut = (entry: ShortcutEntry): string => {
    const descriptions = microcopy.shortcuts.descriptions as Record<
        string,
        string
    >;
    return descriptions[entry.id] ?? entry.id;
};

/** The localized label for a scope bucket. */
export const scopeLabel = (scope: ShortcutScope): string => {
    const scopes = microcopy.shortcuts.scopes as Record<string, string>;
    return scopes[scope] ?? scope;
};

/** Scope render order for the help dialog. */
export const SCOPE_ORDER: readonly ShortcutScope[] = [
    "global",
    "projectPage",
    "board",
    "taskCard",
    "overlay"
];
