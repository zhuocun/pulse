import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "./table";

expect.extend(toHaveNoViolations);

const Example = () => (
    <Table>
        <TableHeader>
            <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
            </TableRow>
        </TableHeader>
        <TableBody>
            <TableRow>
                <TableCell>Alpha</TableCell>
                <TableCell>Active</TableCell>
            </TableRow>
        </TableBody>
    </Table>
);

describe("Table", () => {
    it("renders semantic table rows and cells", () => {
        render(<Example />);
        expect(screen.getByRole("table")).toBeInTheDocument();
        expect(
            screen.getByRole("columnheader", { name: "Name" })
        ).toBeInTheDocument();
        expect(screen.getByRole("cell", { name: "Alpha" })).toBeInTheDocument();
    });

    it("has no axe violations", async () => {
        const { container } = render(<Example />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
