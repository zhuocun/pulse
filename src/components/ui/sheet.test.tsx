import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { microcopy } from "@/constants/microcopy";

import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle
} from "./sheet";

expect.extend(toHaveNoViolations);

const Example = () => (
    <Sheet defaultOpen>
        <SheetContent side="right">
            <SheetHeader>
                <SheetTitle>Activity</SheetTitle>
                <SheetDescription>Recent changes.</SheetDescription>
            </SheetHeader>
        </SheetContent>
    </Sheet>
);

describe("Sheet", () => {
    it("renders an accessible dialog panel with a title", () => {
        render(<Example />);
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { name: "Activity" })
        ).toBeInTheDocument();
    });

    it("labels the close affordance from microcopy (no hard-coded string)", () => {
        render(<Example />);
        const close = screen.getByRole("button", {
            name: microcopy.actions.close
        });
        expect(close).toHaveClass("size-8");
        expect(close).toHaveClass("coarse:size-11");
        expect(close.querySelector("svg")).toHaveClass("size-4");
    });

    it("has no axe violations", async () => {
        const { baseElement } = render(<Example />);
        expect(await axe(baseElement)).toHaveNoViolations();
    });
});
