import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { microcopy } from "@/constants/microcopy";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "./dialog";

expect.extend(toHaveNoViolations);

const Example = () => (
    <Dialog defaultOpen>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Edit project</DialogTitle>
                <DialogDescription>Update the details below.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
                <button type="button">Save</button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);

describe("Dialog", () => {
    it("renders an accessible dialog with a title", () => {
        render(<Example />);
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { name: "Edit project" })
        ).toBeInTheDocument();
    });

    it("labels the close affordance from microcopy (no hard-coded string)", () => {
        render(<Example />);
        expect(
            screen.getByRole("button", { name: microcopy.actions.close })
        ).toBeInTheDocument();
    });

    it("has no axe violations", async () => {
        const { baseElement } = render(<Example />);
        expect(await axe(baseElement)).toHaveNoViolations();
    });
});
