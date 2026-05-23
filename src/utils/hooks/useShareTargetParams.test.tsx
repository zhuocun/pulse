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

    /*
     * URLSearchParams.get() decodes percent-escaped reserved characters
     * (%2B → +, %26 → &, %2F → /, %3D → =) verbatim — share consumers
     * see the decoded value, not the raw escape. This test pins that
     * contract so a future change to manual decoding doesn't silently
     * regress.
     */
    it("decodes percent-encoded reserved characters in text", () => {
        const { result } = renderHook(() => useShareTargetParams(), {
            wrapper: withRoute("/share?text=a%2Bb%26c%3Dd%2Fe")
        });

        expect(result.current.text).toBe("a+b&c=d/e");
    });

    /*
     * `+` in an application/x-www-form-urlencoded query is the legacy
     * space synonym; `URLSearchParams` decodes it to a literal space.
     * `%2B` is the only way to send a literal `+`. The two cases must
     * stay distinguishable through the hook.
     */
    it("decodes + as a space and %2B as a literal plus", () => {
        const { result } = renderHook(() => useShareTargetParams(), {
            wrapper: withRoute("/share?text=a+b&title=a%2Bb")
        });

        expect(result.current.text).toBe("a b");
        expect(result.current.title).toBe("a+b");
    });
});
