import React from "react";

import { flattenSlots } from "./flattenSlots";

/**
 * `flattenSlots` is the shared helper that descends through fragments +
 * arrays to a flat list of leaf nodes (dropping falsy entries), so a
 * grouped surface (GlassActionCluster capsule, SettingsSection table)
 * gets exactly one slot — and therefore one divider boundary — per leaf
 * child even when the children arrive wrapped in conditionally-rendered
 * fragments.
 *
 * Identity is asserted via the elements' `key` / props rather than
 * referential equality because `React.Children.toArray` clones each node
 * with a derived key as it normalises the tree.
 */
const labelsOf = (nodes: React.ReactNode[]): string[] =>
    nodes.map((node) => {
        const element = node as React.ReactElement<{ "data-label"?: string }>;
        return element.props["data-label"] ?? "";
    });

const leaf = (label: string): React.ReactElement =>
    React.createElement("div", { "data-label": label, key: label });

describe("flattenSlots", () => {
    it("returns direct children unchanged (one slot each, in order)", () => {
        const out = flattenSlots([leaf("a"), leaf("b"), leaf("c")]);

        expect(out).toHaveLength(3);
        expect(labelsOf(out)).toEqual(["a", "b", "c"]);
    });

    it("descends into nested fragments so each leaf gets its own slot", () => {
        const tree = React.createElement(
            React.Fragment,
            null,
            leaf("a"),
            React.createElement(
                React.Fragment,
                null,
                React.createElement(React.Fragment, null, leaf("b")),
                leaf("c")
            )
        );

        const out = flattenSlots(tree);

        // Three leaves across two levels of fragment nesting → three slots.
        expect(out).toHaveLength(3);
        expect(labelsOf(out)).toEqual(["a", "b", "c"]);
    });

    it("flattens arrays of children", () => {
        const out = flattenSlots([[leaf("a"), leaf("b")], leaf("c")]);

        expect(out).toHaveLength(3);
        expect(labelsOf(out)).toEqual(["a", "b", "c"]);
    });

    it("drops falsy entries (false / null / undefined)", () => {
        const out = flattenSlots([
            leaf("a"),
            false,
            null,
            undefined,
            leaf("b")
        ]);

        // Only the two real elements survive.
        expect(out).toHaveLength(2);
        expect(labelsOf(out)).toEqual(["a", "b"]);
    });

    it("drops falsy entries nested inside fragments", () => {
        const cond = false;
        const tree = React.createElement(
            React.Fragment,
            null,
            leaf("a"),
            cond && leaf("hidden"),
            React.createElement(React.Fragment, null, null, leaf("b"))
        );

        const out = flattenSlots(tree);

        expect(out).toHaveLength(2);
        expect(labelsOf(out)).toEqual(["a", "b"]);
    });

    it("preserves leaf collection order across mixed nesting", () => {
        const tree = React.createElement(
            React.Fragment,
            null,
            leaf("1"),
            [leaf("2"), leaf("3")],
            React.createElement(React.Fragment, null, leaf("4"))
        );

        expect(labelsOf(flattenSlots(tree))).toEqual(["1", "2", "3", "4"]);
    });

    it("returns an empty list for entirely falsy input", () => {
        expect(flattenSlots([false, null, undefined])).toEqual([]);
        expect(flattenSlots(null)).toEqual([]);
    });
});
