import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle
} from "./card";

expect.extend(toHaveNoViolations);

describe("Card", () => {
    it("renders composed header, content, and footer", () => {
        render(
            <Card>
                <CardHeader>
                    <CardTitle>Project</CardTitle>
                    <CardDescription>A description</CardDescription>
                </CardHeader>
                <CardContent>Body</CardContent>
                <CardFooter>Footer</CardFooter>
            </Card>
        );
        expect(screen.getByText("Project")).toBeInTheDocument();
        expect(screen.getByText("Body")).toBeInTheDocument();
        expect(screen.getByText("Footer")).toBeInTheDocument();
    });

    it("has no axe violations", async () => {
        const { container } = render(
            <Card>
                <CardHeader>
                    <CardTitle>Project</CardTitle>
                </CardHeader>
                <CardContent>Body</CardContent>
            </Card>
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
