/**
 * Tests for the BoardMinimap (Phase 4.6 of `docs/todo/ui-todo.md`).
 *
 * The minimap is purely visual chrome — it doesn't own state outside
 * the scroll ref it reads from / writes to. Tests therefore exercise
 * three contracts:
 *   1. The component-level gate: < `minColumnsToShow` columns → `null`.
 *   2. Visual segments + accessible names: one button per column,
 *      aria-label includes name + task count + viewport status, the
 *      container is a `<nav aria-label="Board minimap">` landmark.
 *   3. Scroll wiring: clicking a segment moves the scroll container
 *      (smooth on `prefers-reduced-motion: no-preference`, instant on
 *      reduce), and the in-view highlight tracks the container's
 *      live `scrollLeft`.
 *
 * jsdom doesn't lay anything out, so we synthesise `offsetLeft` /
 * `offsetWidth` / `clientWidth` / `scrollLeft` directly on the test
 * DOM and dispatch synthetic `scroll` events. This pins the geometry
 * math (interval overlap, smooth-scroll target) without coupling to
 * the real layout engine.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";

import BoardMinimap, { type MinimapColumn } from "./index";

/**
 * setupTests.ts installs `matchMedia` as writable-but-not-configurable,
 * so `Object.defineProperty` here throws. We assign through the
 * descriptor's setter instead (the property is writable, so a plain
 * `window.matchMedia = …` works) and rely on Jest's restore semantics
 * + the per-test `beforeEach` reset to keep tests independent.
 */
const matchMediaMock = (matches: boolean) => {
    (
        window as unknown as { matchMedia: (q: string) => MediaQueryList }
    ).matchMedia = (query: string) =>
        ({
            matches,
            media: query,
            onchange: null,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            addListener: jest.fn(),
            removeListener: jest.fn(),
            dispatchEvent: jest.fn()
        }) as unknown as MediaQueryList;
};

const buildColumns = (n: number): MinimapColumn[] =>
    Array.from({ length: n }, (_, i) => ({
        id: `col-${i + 1}`,
        name: `Column ${i + 1}`,
        taskCount: i + 1
    }));

/**
 * Builds a host element that behaves like the real ColumnContainer:
 *   - is the scroll container (overflow-x: auto, scrollLeft mutable)
 *   - has children tagged with `data-minimap-column-id` so the
 *     minimap's lookup query succeeds.
 *
 * Returns the parent DOM node + a ref that mimics
 * `RefObject<HTMLElement>` pointing at it. The host is appended to
 * `document.body` so jsdom queryable getters work.
 */
const buildScrollHost = ({
    columns,
    scrollWidth = 2000,
    clientWidth = 800,
    columnWidth = 200,
    scrollLeft = 0
}: {
    columns: MinimapColumn[];
    scrollWidth?: number;
    clientWidth?: number;
    columnWidth?: number;
    scrollLeft?: number;
}) => {
    const host = document.createElement("div");
    host.setAttribute("data-testid", "scroll-host");
    Object.defineProperty(host, "scrollLeft", {
        configurable: true,
        get() {
            return this.currentScrollLeft ?? scrollLeft;
        },
        set(value: number) {
            this.currentScrollLeft = value;
        }
    });
    Object.defineProperty(host, "clientWidth", {
        configurable: true,
        get: () => clientWidth
    });
    Object.defineProperty(host, "scrollWidth", {
        configurable: true,
        get: () => scrollWidth
    });
    Object.defineProperty(host, "offsetLeft", {
        configurable: true,
        get: () => 0
    });
    /*
     * Reviewer follow-up (PR #309): the production measurement path
     * now uses `getBoundingClientRect()` rather than `offsetLeft /
     * offsetWidth` so a dnd-positioned column clone reports the same
     * geometry as a statically-laid-out one. Synthesize the host's
     * rect to match the offset/scroll/client triple — the container
     * itself sits at the document origin in jsdom, so the rect's left
     * is always 0 and its width matches the visible client width.
     */
    host.getBoundingClientRect = () =>
        ({
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: clientWidth,
            bottom: 0,
            width: clientWidth,
            height: 0,
            toJSON() {
                return this;
            }
        }) as DOMRect;

    columns.forEach((col, i) => {
        const colEl = document.createElement("div");
        colEl.setAttribute("data-minimap-column-id", col.id);
        Object.defineProperty(colEl, "offsetLeft", {
            configurable: true,
            get: () => i * columnWidth
        });
        Object.defineProperty(colEl, "offsetWidth", {
            configurable: true,
            get: () => columnWidth
        });
        // The production measurement reads `getBoundingClientRect`
        // and subtracts the container's rect + adds `scrollLeft`. The
        // host's rect.left is 0, so the column's rect.left must be
        // `(i * columnWidth) - host.scrollLeft` for the math to land
        // on the same scroll-content-coordinate the offsetLeft path
        // produced. We make the rect reflect the column's position
        // RELATIVE TO THE VIEWPORT, not the scroll content, since
        // that's what a real browser returns — the production code
        // adds `container.scrollLeft` back to recover the content
        // coordinate.
        colEl.getBoundingClientRect = () => {
            const scrollLeftValue = (host as unknown as { scrollLeft: number })
                .scrollLeft;
            const leftRelativeToViewport = i * columnWidth - scrollLeftValue;
            return {
                x: leftRelativeToViewport,
                y: 0,
                left: leftRelativeToViewport,
                top: 0,
                right: leftRelativeToViewport + columnWidth,
                bottom: 0,
                width: columnWidth,
                height: 0,
                toJSON() {
                    return this;
                }
            } as DOMRect;
        };
        host.appendChild(colEl);
    });

    document.body.appendChild(host);

    return { host, ref: createRef<HTMLDivElement>() } as {
        host: HTMLDivElement;
        ref: { current: HTMLDivElement | null };
    };
};

describe("BoardMinimap", () => {
    beforeEach(() => {
        matchMediaMock(false);
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("returns null when the column count is below the threshold (default 5)", () => {
        const columns = buildColumns(4);
        const { container } = render(
            <BoardMinimap
                columns={columns}
                scrollContainerRef={createRef<HTMLDivElement>()}
            />
        );
        expect(container.firstChild).toBeNull();
        // Sanity: the data-testid hook is also absent so a parent
        // component's `getByTestId` would correctly throw.
        expect(screen.queryByTestId("board-minimap")).not.toBeInTheDocument();
    });

    it("returns null when minColumnsToShow is raised above the column count", () => {
        const columns = buildColumns(6);
        const { container } = render(
            <BoardMinimap
                columns={columns}
                minColumnsToShow={10}
                scrollContainerRef={createRef<HTMLDivElement>()}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders one button per column when columns.length >= threshold", () => {
        const columns = buildColumns(5);
        const { ref, host } = buildScrollHost({ columns });
        ref.current = host;

        render(
            <BoardMinimap
                columns={columns}
                scrollContainerRef={
                    ref as unknown as React.RefObject<HTMLElement>
                }
            />
        );

        const segments = screen.getAllByRole("button");
        expect(segments).toHaveLength(5);
        for (let i = 0; i < 5; i += 1) {
            expect(segments[i]).toHaveAttribute(
                "data-column-id",
                `col-${i + 1}`
            );
        }
    });

    it('exposes a `<nav aria-label="Board minimap">` landmark for screen-reader skipping', () => {
        const columns = buildColumns(5);
        const { ref, host } = buildScrollHost({ columns });
        ref.current = host;

        render(
            <BoardMinimap
                columns={columns}
                scrollContainerRef={
                    ref as unknown as React.RefObject<HTMLElement>
                }
            />
        );

        const nav = screen.getByRole("navigation", { name: /board minimap/i });
        expect(nav).toBeInTheDocument();
    });

    it("includes column name + task count + viewport status in each segment's aria-label", () => {
        // 5 columns, scrollLeft=0, clientWidth=800, columnWidth=200
        // → columns 0..3 visible (0–800 px), column 4 off-screen.
        const columns = buildColumns(5);
        const { ref, host } = buildScrollHost({
            columns,
            scrollLeft: 0,
            clientWidth: 800,
            columnWidth: 200,
            scrollWidth: 1000
        });
        ref.current = host;

        render(
            <BoardMinimap
                columns={columns}
                scrollContainerRef={
                    ref as unknown as React.RefObject<HTMLElement>
                }
            />
        );

        // First column shows the singular form because taskCount=1.
        const first = screen.getByTestId("board-minimap-segment-col-1");
        expect(first).toHaveAttribute(
            "aria-label",
            "Column 1 column, 1 task, currently in view"
        );

        // Fifth column uses the plural form and is off-screen at
        // scrollLeft=0 (its offsetLeft=800 sits at the right edge,
        // exclusive — viewport is [0, 800), column is [800, 1000)).
        const fifth = screen.getByTestId("board-minimap-segment-col-5");
        expect(fifth).toHaveAttribute(
            "aria-label",
            "Column 5 column, 5 tasks, currently off-screen"
        );
    });

    it("clicking a segment calls scrollTo on the container (smooth by default)", () => {
        const columns = buildColumns(5);
        const { ref, host } = buildScrollHost({
            columns,
            clientWidth: 400,
            columnWidth: 200
        });
        const scrollTo = jest.fn();
        host.scrollTo = scrollTo as unknown as typeof host.scrollTo;
        ref.current = host;

        render(
            <BoardMinimap
                columns={columns}
                scrollContainerRef={
                    ref as unknown as React.RefObject<HTMLElement>
                }
            />
        );

        fireEvent.click(screen.getByTestId("board-minimap-segment-col-3"));

        expect(scrollTo).toHaveBeenCalledTimes(1);
        const [arg] = scrollTo.mock.calls[0] as [
            {
                left: number;
                behavior: "smooth" | "auto";
            }
        ];
        // Column 3 sits at offsetLeft=400, columnWidth=200, viewport=400.
        // Centred target = 400 - (400 - 200)/2 = 300.
        expect(arg.left).toBe(300);
        expect(arg.behavior).toBe("smooth");
    });

    it('falls back to behavior: "auto" when prefers-reduced-motion is set', () => {
        matchMediaMock(true);

        const columns = buildColumns(5);
        const { ref, host } = buildScrollHost({
            columns,
            clientWidth: 400,
            columnWidth: 200
        });
        const scrollTo = jest.fn();
        host.scrollTo = scrollTo as unknown as typeof host.scrollTo;
        ref.current = host;

        render(
            <BoardMinimap
                columns={columns}
                scrollContainerRef={
                    ref as unknown as React.RefObject<HTMLElement>
                }
            />
        );

        fireEvent.click(screen.getByTestId("board-minimap-segment-col-2"));

        const [arg] = scrollTo.mock.calls[0] as [{ behavior: string }];
        expect(arg.behavior).toBe("auto");
    });

    it("falls back to a direct scrollLeft assignment when scrollTo throws", () => {
        const columns = buildColumns(5);
        const { ref, host } = buildScrollHost({
            columns,
            clientWidth: 400,
            columnWidth: 200
        });
        host.scrollTo = (() => {
            throw new TypeError("not supported");
        }) as unknown as typeof host.scrollTo;
        ref.current = host;

        render(
            <BoardMinimap
                columns={columns}
                scrollContainerRef={
                    ref as unknown as React.RefObject<HTMLElement>
                }
            />
        );

        fireEvent.click(screen.getByTestId("board-minimap-segment-col-4"));

        // Column 4 at offsetLeft=600, columnWidth=200, viewport=400
        // → target = 600 - (400 - 200)/2 = 500.
        expect(host.scrollLeft).toBe(500);
    });

    it("updates the in-view highlight when the container's scrollLeft changes", () => {
        const columns = buildColumns(5);
        const { ref, host } = buildScrollHost({
            columns,
            scrollLeft: 0,
            clientWidth: 400,
            columnWidth: 200,
            scrollWidth: 1000
        });
        ref.current = host;

        render(
            <BoardMinimap
                columns={columns}
                scrollContainerRef={
                    ref as unknown as React.RefObject<HTMLElement>
                }
            />
        );

        // At scrollLeft=0, viewport [0, 400) → cols 1 + 2 in view.
        expect(
            screen.getByTestId("board-minimap-segment-col-1")
        ).toHaveAttribute("data-in-view", "true");
        expect(
            screen.getByTestId("board-minimap-segment-col-3")
        ).toHaveAttribute("data-in-view", "false");

        /*
         * Reviewer follow-up (PR #309): the scroll handler now defers
         * its state write to the next `requestAnimationFrame` so a
         * fling scroll only re-renders the minimap once per frame
         * instead of on every native scroll tick. We stub rAF to call
         * the callback synchronously for the assertion window so the
         * test still observes the post-scroll state without polling
         * a real timer. The stub is restored at the end of the act
         * block so subsequent tests see the default jsdom rAF.
         */
        const rafSpy = jest
            .spyOn(window, "requestAnimationFrame")
            .mockImplementation((cb: FrameRequestCallback): number => {
                cb(0);
                return 0;
            });
        try {
            act(() => {
                host.scrollLeft = 600;
                host.dispatchEvent(new Event("scroll"));
            });
        } finally {
            rafSpy.mockRestore();
        }

        expect(
            screen.getByTestId("board-minimap-segment-col-1")
        ).toHaveAttribute("data-in-view", "false");
        expect(
            screen.getByTestId("board-minimap-segment-col-4")
        ).toHaveAttribute("data-in-view", "true");
        expect(
            screen.getByTestId("board-minimap-segment-col-5")
        ).toHaveAttribute("data-in-view", "true");
    });

    it("renders nothing when the columns array is empty regardless of threshold", () => {
        const { container } = render(
            <BoardMinimap
                columns={[]}
                minColumnsToShow={0}
                scrollContainerRef={createRef<HTMLDivElement>()}
            />
        );
        // minColumnsToShow=0 + an empty array still has length 0 which
        // is not >= 0 strictly, so the guard returns null and the
        // <nav> is never mounted. The spec is silent on the
        // edge case (a board with zero columns is already the
        // EmptyState surface), so the safest behaviour is no
        // chrome at all.
        expect(container.firstChild).toBeNull();
    });

    it('marks the currently in-view segments with aria-current="true"', () => {
        const columns = buildColumns(5);
        const { ref, host } = buildScrollHost({
            columns,
            scrollLeft: 0,
            clientWidth: 400,
            columnWidth: 200
        });
        ref.current = host;

        render(
            <BoardMinimap
                columns={columns}
                scrollContainerRef={
                    ref as unknown as React.RefObject<HTMLElement>
                }
            />
        );

        // Cols 1 + 2 are in view at scrollLeft=0 / clientWidth=400.
        expect(
            screen.getByTestId("board-minimap-segment-col-1")
        ).toHaveAttribute("aria-current", "true");
        expect(
            screen.getByTestId("board-minimap-segment-col-2")
        ).toHaveAttribute("aria-current", "true");
        // Cols 3+ should not carry aria-current at all (undefined),
        // not "false" — aria-current="false" is technically valid but
        // VoiceOver still announces it as "current", which is wrong.
        expect(
            screen.getByTestId("board-minimap-segment-col-3")
        ).not.toHaveAttribute("aria-current");
    });

    /*
     * Reviewer follow-up (PR #309): the scroll handler routes its
     * `setViewport` write through `requestAnimationFrame` so a fling
     * scroll firing 120 native events/second collapses to one render
     * per frame instead of one render per tick. The contract here is
     * "the scroll listener schedules a rAF" — we count the rAF
     * invocations across a burst of scroll events. Any future
     * refactor that drops the batching would call the listener
     * synchronously and the spy count would stay at 0.
     */
    it("batches native scroll events through requestAnimationFrame (PR #309 follow-up)", () => {
        const columns = buildColumns(5);
        const { ref, host } = buildScrollHost({
            columns,
            scrollLeft: 0,
            clientWidth: 400,
            columnWidth: 200,
            scrollWidth: 1000
        });
        ref.current = host;

        const rafSpy = jest
            .spyOn(window, "requestAnimationFrame")
            .mockImplementation((cb: FrameRequestCallback): number => {
                cb(0);
                return 1;
            });
        const cancelSpy = jest
            .spyOn(window, "cancelAnimationFrame")
            .mockImplementation(() => {});

        try {
            render(
                <BoardMinimap
                    columns={columns}
                    scrollContainerRef={
                        ref as unknown as React.RefObject<HTMLElement>
                    }
                />
            );

            // Mount-time write happens synchronously (via applyUpdate),
            // so the rAF counter starts at zero. Now fire a burst of
            // scroll events and assert each one routes through rAF.
            rafSpy.mockClear();
            cancelSpy.mockClear();
            act(() => {
                for (let i = 0; i < 5; i += 1) {
                    host.scrollLeft = i * 100;
                    host.dispatchEvent(new Event("scroll"));
                }
            });

            // Each scroll event scheduled a rAF; the cancel spy
            // dropped the prior frame's pending callback so only the
            // newest tick lands. That's the batching contract — five
            // events, five rAF schedules, four cancels of the prior
            // pending frame.
            expect(rafSpy).toHaveBeenCalledTimes(5);
            expect(cancelSpy).toHaveBeenCalledTimes(4);
        } finally {
            rafSpy.mockRestore();
            cancelSpy.mockRestore();
        }
    });
});
