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
});
