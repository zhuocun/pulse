import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { declaresTouchTarget } from "./testHelpers";

expect.extend(toHaveNoViolations);

const Example = () => (
    <Tabs defaultValue="overview">
        <TabsList aria-label="Sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview panel</TabsContent>
        <TabsContent value="activity">Activity panel</TabsContent>
    </Tabs>
);

describe("Tabs", () => {
    it("switches the visible panel on tab activation", async () => {
        render(<Example />);
        expect(screen.getByText("Overview panel")).toBeVisible();
        // Radix Tabs selects on mousedown/focus, not a bare click.
        fireEvent.mouseDown(screen.getByRole("tab", { name: "Activity" }));
        expect(await screen.findByText("Activity panel")).toBeVisible();
    });

    it("declares a touch-target height of at least 44px (WCAG 2.5.8)", () => {
        render(<Example />);
        expect(
            declaresTouchTarget(screen.getByRole("tab", { name: "Overview" }))
        ).toBe(true);
    });

    it("has no axe violations", async () => {
        const { container } = render(<Example />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
