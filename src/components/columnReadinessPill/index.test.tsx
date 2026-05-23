import { fireEvent, render, screen } from "@testing-library/react";

import type { ColumnReadinessReport } from "../../utils/hooks/useColumnReadiness";

import ColumnReadinessPill from "./index";

const baseTask = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "col-1",
    coordinatorId: "member-1",
    epic: "Feature",
    index: 0,
    note: "Acceptance criteria.",
    projectId: "project-1",
    storyPoints: 1,
    taskName: "Implement login",
    type: "Task",
    ...overrides
});

const buildReport = (
    overrides: Partial<ColumnReadinessReport> = {}
): ColumnReadinessReport => ({
    readyCount: 4,
    totalCount: 5,
    status: "ready",
    blockerTasks: [],
    ...overrides
});

describe("ColumnReadinessPill", () => {
    it("returns null when the report status is neutral", () => {
        const { container } = render(
            <ColumnReadinessPill
                report={buildReport({
                    readyCount: 2,
                    totalCount: 3,
                    status: "neutral"
                })}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders the ready label and a machine-readable aria-label when status=ready", () => {
        render(
            <ColumnReadinessPill
                report={buildReport({
                    readyCount: 8,
                    totalCount: 10,
                    status: "ready"
                })}
            />
        );
        const pill = screen.getByTestId("column-readiness-pill");
        expect(pill).toHaveAttribute("data-status", "ready");
        expect(pill).toHaveAttribute("role", "button");
        expect(pill).toHaveAccessibleName(/8 of 10 tasks ready/i);
        expect(screen.getByText("Ready to ship")).toBeInTheDocument();
    });

    it("renders the grooming label and aria-label when status=needs-grooming", () => {
        render(
            <ColumnReadinessPill
                report={buildReport({
                    readyCount: 1,
                    totalCount: 5,
                    status: "needs-grooming",
                    blockerTasks: []
                })}
            />
        );
        const pill = screen.getByTestId("column-readiness-pill");
        expect(pill).toHaveAttribute("data-status", "needs-grooming");
        expect(pill).toHaveAccessibleName(/1 of 5 tasks ready.*grooming/i);
        expect(screen.getByText("Needs grooming")).toBeInTheDocument();
    });

    it("opens a popover listing blocker tasks when clicked", () => {
        render(
            <ColumnReadinessPill
                report={buildReport({
                    readyCount: 1,
                    totalCount: 4,
                    status: "needs-grooming",
                    blockerTasks: [
                        {
                            task: baseTask({
                                _id: "blocker-1",
                                taskName: "Untriaged bug"
                            }),
                            reasons: [
                                "No coordinator assigned.",
                                "Type is missing."
                            ]
                        },
                        {
                            task: baseTask({
                                _id: "blocker-2",
                                taskName: "Empty description"
                            }),
                            reasons: ["No description or acceptance criteria."]
                        }
                    ]
                })}
            />
        );
        const pill = screen.getByTestId("column-readiness-pill");
        fireEvent.click(pill);
        expect(screen.getByText("Untriaged bug")).toBeInTheDocument();
        expect(screen.getByText("Empty description")).toBeInTheDocument();
        // Reasons collapse via " · " between them.
        expect(
            screen.getByText(/No coordinator assigned\..*Type is missing\./)
        ).toBeInTheDocument();
    });

    it("opens the popover via keyboard Enter (role=button parity)", () => {
        render(
            <ColumnReadinessPill
                report={buildReport({
                    readyCount: 4,
                    totalCount: 5,
                    status: "ready",
                    blockerTasks: [
                        {
                            task: baseTask({
                                _id: "b1",
                                taskName: "Polish copy"
                            }),
                            reasons: ["Epic is empty."]
                        }
                    ]
                })}
            />
        );
        const pill = screen.getByTestId("column-readiness-pill");
        fireEvent.keyDown(pill, { key: "Enter" });
        expect(screen.getByText("Polish copy")).toBeInTheDocument();
    });

    it("shows the empty-ready helper copy when no tasks are blockers but the pill is `ready`", () => {
        render(
            <ColumnReadinessPill
                report={buildReport({
                    readyCount: 5,
                    totalCount: 5,
                    status: "ready",
                    blockerTasks: []
                })}
            />
        );
        fireEvent.click(screen.getByTestId("column-readiness-pill"));
        expect(
            screen.getByText(/Every task in this column passed the check/i)
        ).toBeInTheDocument();
    });

    it("makes the pill keyboard-reachable via tabIndex=0", () => {
        render(
            <ColumnReadinessPill
                report={buildReport({
                    readyCount: 4,
                    totalCount: 5,
                    status: "ready"
                })}
            />
        );
        const pill = screen.getByTestId("column-readiness-pill");
        expect(pill).toHaveAttribute("tabindex", "0");
    });

    /*
     * The Popover clones its child and attaches the click/keyboard
     * handlers to the child's ROOT — the <Tag>. A screen-reader user
     * navigating to the trigger by role/landmark lands on the Tag, so
     * the aria-label has to be on the Tag (not only on the inner
     * span) or the AT announces an unlabelled "button" / "tag".
     */
    /*
     * Followup B (PR #308 review): on `pointer: coarse` viewports the
     * pill needs a >=44x44 touch hit area without inflating its visible
     * size (the column header would otherwise reflow). We pad the area
     * out via a ::before pseudo-element. JSDOM doesn't run the
     * `@media (pointer: coarse)` block at layout time, but the
     * `data-touch-hit-area` marker on the styled root lets us assert
     * the contract is wired up — any future refactor that drops the
     * styled wrapper has to keep the marker (and therefore the rule).
     *
     * PR #309 review follow-up: the previous version asserted
     * `pill.className.match(/css-/)` which broke any time Emotion's
     * class hash format changed (even a styled-components dep bump
     * could flip it). Replace with a hard-coded `data-touch-hit-area`
     * attribute on the styled root — a real contract that survives
     * future class-name shape changes.
     */
    it("uses a styled root that owns the pointer:coarse hit-area expander (Followup B)", () => {
        render(
            <ColumnReadinessPill
                report={buildReport({
                    readyCount: 4,
                    totalCount: 5,
                    status: "ready"
                })}
            />
        );
        const pill = screen.getByTestId("column-readiness-pill");
        expect(pill.tagName).toBe("SPAN");
        // Load-bearing contract: the styled root tags itself with the
        // `data-touch-hit-area` marker so the WCAG 2.5.5 expander
        // can't silently regress. A refactor that drops the PillRoot
        // wrapper would render a raw <span> with no attribute and
        // this assertion would fail loudly.
        expect(pill).toHaveAttribute("data-touch-hit-area", "44");
    });

    it("places the readiness aria-label on the outer Popover trigger root, not only the inner pill", () => {
        render(
            <ColumnReadinessPill
                report={buildReport({
                    readyCount: 8,
                    totalCount: 10,
                    status: "ready"
                })}
            />
        );
        const innerPill = screen.getByTestId("column-readiness-pill");
        // The outer trigger is the parent .ant-tag element; AntD's
        // Popover wires its click/keyboard handlers to that node, so
        // its aria-label must surface the readiness count.
        const outerTrigger = innerPill.closest(".ant-tag");
        expect(outerTrigger).not.toBeNull();
        expect(outerTrigger).toHaveAttribute(
            "aria-label",
            expect.stringMatching(/8 of 10 tasks ready/i)
        );
    });
});
