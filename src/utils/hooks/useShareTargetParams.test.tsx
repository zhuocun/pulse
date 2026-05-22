import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import useShareTargetParams from "./useShareTargetParams";

const withRoute = (initialEntry: string) => {
    const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
    );
    return wrapper;
};

describe("useShareTargetParams", () => {
    it("returns all three fields when the URL carries title, text, and url", () => {
        const { result } = renderHook(() => useShareTargetParams(), {
            wrapper: withRoute(
                "/share?title=Pulse%20release%20notes&text=The%20latest%20build%20ships%20Web%20Share%20Target&url=https%3A%2F%2Fexample.com%2Frelease"
            )
        });

        expect(result.current).toEqual({
            title: "Pulse release notes",
            text: "The latest build ships Web Share Target",
            url: "https://example.com/release"
        });
    });

    it("returns undefined for every field when no params are present", () => {
        const { result } = renderHook(() => useShareTargetParams(), {
            wrapper: withRoute("/share")
        });

        expect(result.current).toEqual({
            title: undefined,
            text: undefined,
            url: undefined
        });
    });

    it("returns undefined for missing fields when only some params are present", () => {
        const { result } = renderHook(() => useShareTargetParams(), {
            wrapper: withRoute("/share?text=Just%20a%20note")
        });

        expect(result.current).toEqual({
            title: undefined,
            text: "Just a note",
            url: undefined
        });
    });
});
