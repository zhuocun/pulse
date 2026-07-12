import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { Skeleton } from "./skeleton";

expect.extend(toHaveNoViolations);

describe("Skeleton", () => {
    it("renders a decorative, aria-hidden placeholder", () => {
        const { container } = render(<Skeleton className="h-4 w-20" />);
        expect(container.firstElementChild).toHaveAttribute("aria-hidden");
    });

    it("has no axe violations", async () => {
        const { container } = render(<Skeleton className="h-4 w-20" />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
