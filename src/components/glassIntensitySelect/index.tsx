import { useCallback } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Typography } from "@/components/ui/typography";

import { microcopy } from "../../constants/microcopy";
import type { ReduxDispatch, RootState } from "../../store";
import {
    userPreferencesActions,
    type GlassIntensityPreference
} from "../../store/reducers/userPreferencesSlice";
import { useReduxDispatch, useReduxSelector } from "../../utils/hooks/useRedux";

/**
 * Phase 5 "Liquid Glass" Wave 2 T4 — the user-facing glass intensity
 * picker. Surfaces the four options from the slice's
 * `GlassIntensityPreference` enum as a ToggleGroup (single-select),
 * modeled after `LanguageSwitcher` so the account-dropdown settings rows
 * feel cut from the same cloth.
 *
 *   - Auto    — defer to the runtime ladder in `useGlassIntensity`.
 *   - Clear   — maximum show-through, modest blur.
 *   - Regular — balanced default (the shipping recipe).
 *   - Solid   — opt out of glass entirely. Critical for accessibility
 *               and for users who prefer higher-contrast / lower-GPU
 *               opaque rendering.
 *
 * Reads from `userPreferences.glassIntensity` and writes via
 * `setGlassIntensity`. The slice persists through the store middleware on
 * every dispatch, so the choice round-trips through localStorage.
 *
 * The options are derived from the same enum the slice uses, so adding a
 * new intensity is a single edit to the type and the i18n labels.
 */

interface OptionDescriptor {
    value: GlassIntensityPreference;
    labelKey: keyof typeof microcopy.settings;
}

/*
 * Source of truth for the order options render in. "Auto" leads because
 * it's the default + recommended choice; the other three descend by
 * translucency so the slider-feel matches the on-screen progression.
 */
const OPTIONS: readonly OptionDescriptor[] = [
    { value: "auto", labelKey: "glassIntensityAuto" },
    { value: "clear", labelKey: "glassIntensityClear" },
    { value: "regular", labelKey: "glassIntensityRegular" },
    { value: "solid", labelKey: "glassIntensitySolid" }
] as const;

const GlassIntensitySelect = () => {
    const dispatch = useReduxDispatch() as ReduxDispatch;
    const intensity = useReduxSelector<GlassIntensityPreference>(
        (state: RootState) => state.userPreferences.glassIntensity
    );

    const handleChange = useCallback(
        (value: string) => {
            // Radix single-select emits "" when the active item is
            // re-pressed; Segmented never deselects, so ignore an empty
            // value to keep exactly one intensity selected.
            if (!value) return;
            dispatch(
                userPreferencesActions.setGlassIntensity(
                    value as GlassIntensityPreference
                )
            );
        },
        [dispatch]
    );

    return (
        <div
            aria-label={microcopy.settings.changeGlassIntensity}
            className="flex min-w-[240px] items-center justify-between gap-sm px-xs py-xxs"
            role="group"
        >
            <Typography.Text>
                {microcopy.settings.glassIntensity}
            </Typography.Text>
            <ToggleGroup
                aria-label={microcopy.settings.changeGlassIntensity}
                onValueChange={handleChange}
                size="sm"
                type="single"
                value={intensity}
            >
                {OPTIONS.map((entry) => (
                    <ToggleGroupItem key={entry.value} value={entry.value}>
                        {microcopy.settings[entry.labelKey] as string}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </div>
    );
};

export default GlassIntensitySelect;
