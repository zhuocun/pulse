import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Separator } from "./separator";

expect.extend(toHaveNoViolations);

describe("Separator", () => {
    it("renders a decorative separator element", () => {
        const { container } = render(<Separator />);
        expect(container.querySelector("[data-orientation]")).not.toBeNull();
    });

    it("has no axe violations (horizontal and vertical)", async () => {
        const { container } = render(
            <div>
                <Separator />
                <Separator orientation="vertical" />
            </div>
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
