import { act, renderHook } from "@testing-library/react";

import useOnboardingTour, {
    ONBOARDING_DISMISSED_KEY
} from "./useOnboardingTour";

describe("useOnboardingTour", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("auto-opens when eligible and not previously dismissed", () => {
        const { result } = renderHook(() => useOnboardingTour(true));
        expect(result.current.open).toBe(true);
    });

    it("does NOT open when the dismissed flag is already set", () => {
        window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true");
        const { result } = renderHook(() => useOnboardingTour(true));
        expect(result.current.open).toBe(false);
    });

    it("does NOT open when ineligible (unauthenticated / auth page)", () => {
        const { result } = renderHook(() => useOnboardingTour(false));
        expect(result.current.open).toBe(false);
    });

    it("opens once eligibility flips true after mount", () => {
        const { result, rerender } = renderHook(
            ({ eligible }) => useOnboardingTour(eligible),
            { initialProps: { eligible: false } }
        );
        expect(result.current.open).toBe(false);
        rerender({ eligible: true });
        expect(result.current.open).toBe(true);
    });

    it("dismiss closes the tour and persists the flag", () => {
        const { result } = renderHook(() => useOnboardingTour(true));
        expect(result.current.open).toBe(true);

        act(() => {
            result.current.dismiss();
        });

        expect(result.current.open).toBe(false);
        expect(window.localStorage.getItem(ONBOARDING_DISMISSED_KEY)).toBe(
            "true"
        );
    });

    it("stays dismissed across remounts (never auto-shows again)", () => {
        const first = renderHook(() => useOnboardingTour(true));
        act(() => {
            first.result.current.dismiss();
        });
        first.unmount();

        const second = renderHook(() => useOnboardingTour(true));
        expect(second.result.current.open).toBe(false);
    });

    it("reopen re-shows the tour without clearing the dismissed flag", () => {
        const { result } = renderHook(() => useOnboardingTour(true));
        act(() => {
            result.current.dismiss();
        });
        expect(result.current.open).toBe(false);

        act(() => {
            result.current.reopen();
        });
        expect(result.current.open).toBe(true);
        // The dismissed flag stays set — reopen is a manual re-trigger, not
        // a reset, so the next session still won't auto-show.
        expect(window.localStorage.getItem(ONBOARDING_DISMISSED_KEY)).toBe(
            "true"
        );
    });

    it("treats unreadable localStorage as dismissed (no nagging)", () => {
        const spy = jest
            .spyOn(window.localStorage.__proto__, "getItem")
            .mockImplementation(() => {
                throw new Error("denied");
            });
        try {
            const { result } = renderHook(() => useOnboardingTour(true));
            expect(result.current.open).toBe(false);
        } finally {
            spy.mockRestore();
        }
    });

    it("swallows write failures from dismiss (best-effort persistence)", () => {
        const spy = jest
            .spyOn(window.localStorage.__proto__, "setItem")
            .mockImplementation(() => {
                throw new Error("quota");
            });
        try {
            const { result } = renderHook(() => useOnboardingTour(true));
            expect(() =>
                act(() => {
                    result.current.dismiss();
                })
            ).not.toThrow();
            // In-session close still wins even when the write is rejected.
            expect(result.current.open).toBe(false);
        } finally {
            spy.mockRestore();
        }
    });
});
