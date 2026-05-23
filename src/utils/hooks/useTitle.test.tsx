import { renderHook } from "@testing-library/react";

import useTitle, { composeBrandedTitle } from "./useTitle";

describe("composeBrandedTitle", () => {
    it("appends the ' · Pulse' suffix to the page name", () => {
        // QW-20 — single composition helper so every owned auth +
        // project-list surface formats `document.title` the same way.
        expect(composeBrandedTitle("Log in")).toBe("Log in · Pulse");
        expect(composeBrandedTitle("Projects")).toBe("Projects · Pulse");
    });

    it("collapses to just 'Pulse' when the page name is empty", () => {
        // Defensive: an empty page name shouldn't print the ugly
        // leading separator ("· Pulse"). Degrade to the brand alone.
        expect(composeBrandedTitle("")).toBe("Pulse");
    });
});

describe("useTitle", () => {
    const originalTitle = document.title;

    afterEach(() => {
        document.title = originalTitle;
    });

    it("sets the document title and restores the old title on unmount when requested", () => {
        document.title = "Old title";

        const { rerender, unmount } = renderHook(
            ({ title }) => useTitle(title, false),
            {
                initialProps: {
                    title: "Project board"
                }
            }
        );

        expect(document.title).toBe("Project board");

        rerender({ title: "Projects" });

        expect(document.title).toBe("Projects");

        unmount();

        expect(document.title).toBe("Old title");
    });

    it("keeps the new title after unmount by default", () => {
        document.title = "Old title";

        const { unmount } = renderHook(() => useTitle("Project board"));

        expect(document.title).toBe("Project board");

        unmount();

        expect(document.title).toBe("Project board");
    });

    it("writes a brand-suffixed title when callers pass composeBrandedTitle output", () => {
        // The canonical pattern owned auth pages use: pass the result of
        // composeBrandedTitle(page) through to useTitle. The hook itself
        // is brand-agnostic so unrelated callers (board, projectDetail)
        // continue printing their bare titles.
        document.title = "Old title";

        renderHook(() => useTitle(composeBrandedTitle("Log in"), false));

        expect(document.title).toBe("Log in · Pulse");
    });

    it("restores the previous document.title on unmount for the auth-pages call pattern (Bug 7)", () => {
        // Bug 7 — the four auth pages (login, register, forgotPassword,
        // terms) now pass `false` as the second argument so an
        // intermediate route doesn't silently inherit the auth title.
        // Today the project page immediately overrides on navigation,
        // but the restore behaviour guarantees the previous title is
        // preserved for any in-between routes (e.g. the Suspense fallback
        // or a future post-auth interstitial).
        document.title = "Previous title";

        const { unmount } = renderHook(() =>
            useTitle(composeBrandedTitle("Log in"), false)
        );

        expect(document.title).toBe("Log in · Pulse");

        unmount();

        expect(document.title).toBe("Previous title");
    });

    it("captures the old title inside the first effect, not at first render", () => {
        // Regression: snapshotting `document.title` with `useRef(document.title)`
        // ran at render time, which on lazy()-loaded pages fired before
        // the previous route's unmount — the intermediate PageSpin had
        // already overwritten document.title with the wrong value. The
        // capture now lives inside the effect so the snapshot reflects
        // whatever the predecessor route last wrote.
        document.title = "Render-time title";

        const { rerender, unmount } = renderHook(
            ({ title }: { title: string }) => useTitle(title, false),
            {
                initialProps: { title: "First" }
            }
        );

        // Mutating document.title after the first render but BEFORE the
        // first effect committed would have been captured-too-early by
        // the old implementation. The new effect-based capture pinned
        // the snapshot to the value present when the effect ran, which
        // by then is the title the hook just wrote.
        rerender({ title: "Second" });
        expect(document.title).toBe("Second");

        unmount();

        // The captured old title was "Render-time title" — the value
        // present when the first effect ran, before the hook wrote its
        // own title. Restoration brings it back on unmount.
        expect(document.title).toBe("Render-time title");
    });
});
