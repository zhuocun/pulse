import { render, screen } from "@testing-library/react";

import { PageError, PageSpin } from ".";

describe("status components", () => {
    it("renders a full page spinner", () => {
        const { container } = render(<PageSpin />);

        expect(container.querySelector(".ant-spin")).toBeInTheDocument();
    });

    it("renders a supplied page error message", () => {
        render(<PageError error={new Error("Board failed")} />);

        expect(screen.getByText("Board failed")).toBeInTheDocument();
    });

    it("renders the default page error message without an error", () => {
        render(<PageError error={null} />);

        expect(
            screen.getByText("Couldn't load. Please try again.")
        ).toBeInTheDocument();
    });
});
