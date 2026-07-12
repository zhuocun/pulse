import { act, render, screen, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import {
    message,
    resetToastersForTests,
    Toaster,
    useAppMessage
} from "./toast";

expect.extend(toHaveNoViolations);

describe("toast module", () => {
    beforeEach(() => {
        resetToastersForTests();
    });

    it("no-ops (and returns a hide thunk) when no Toaster is mounted", () => {
        const hide = message.success("Saved");
        expect(typeof hide).toBe("function");
        expect(() => hide()).not.toThrow();
        expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    });

    it("useAppMessage returns the same message API", () => {
        const HookProbe = () => {
            const api = useAppMessage();
            return <span data-testid="same">{String(api === message)}</span>;
        };
        render(<HookProbe />);
        expect(screen.getByTestId("same")).toHaveTextContent("true");
    });

    it("renders a toast once a Toaster is mounted", async () => {
        render(<Toaster />);
        act(() => {
            message.success("Project saved");
        });
        await waitFor(() =>
            expect(screen.getByText("Project saved")).toBeInTheDocument()
        );
    });

    it("has no axe violations for the Toaster region", async () => {
        const { container } = render(<Toaster />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
