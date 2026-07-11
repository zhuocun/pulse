import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

expect.extend(toHaveNoViolations);

describe("Avatar", () => {
    it("renders the fallback when no image has loaded", () => {
        render(
            <Avatar>
                <AvatarImage src="" alt="Ada Lovelace" />
                <AvatarFallback>AL</AvatarFallback>
            </Avatar>
        );
        expect(screen.getByText("AL")).toBeInTheDocument();
    });

    it("has no axe violations", async () => {
        const { container } = render(
            <Avatar>
                <AvatarFallback>AL</AvatarFallback>
            </Avatar>
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
