import styled from "@emotion/styled";
import { Segmented, Typography } from "antd";
import { useCallback } from "react";

import { microcopy } from "../../constants/microcopy";
import type { ReduxDispatch, RootState } from "../../store";
import {
    userPreferencesActions,
    type GlassIntensityPreference
} from "../../store/reducers/userPreferencesSlice";
import { space } from "../../theme/tokens";
import { useReduxDispatch, useReduxSelector } from "../../utils/hooks/useRedux";

/**
 * Phase 5 "Liquid Glass" Wave 2 T4 — the user-facing glass intensity
 * picker. Surfaces the four options from the slice's
 * `GlassIntensityPreference` enum as a Segmented control, modeled
 * after the existing `LanguageSwitcher` so the account-dropdown
 * settings rows feel cut from the same cloth.
 *
 *   - Auto    — defer to the runtime ladder in `useGlassIntensity`
 *               (OS `prefers-reduced-transparency` → solid,
 *               `pointer: coarse` → solid, otherwise regular). The
 *               default; brand-new users land here.
 *   - Clear   — maximum show-through, modest blur.
 *   - Regular — balanced default (the shipping recipe).
 *   - Solid   — opt out of glass entirely. Critical for accessibility
 *               (reduced-transparency users on Firefox, which lacks
 *               OS-level `prefers-reduced-transparency` today) and
 *               for users who prefer the higher-contrast / lower-GPU
 *               opaque rendering.
 *
 * Reads from `userPreferences.glassIntensity` and writes via
 * `setGlassIntensity`. The slice persists through the store
 * middleware on every dispatch, so the choice round-trips through
 * localStorage automatically.
 *
 * The Segmented options are derived from the same enum the slice
 * uses, so adding a new intensity (or renaming one) is a single edit
 * to the type and the i18n labels — the picker stays in sync without
 * a manual update.
 */

const Row = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.sm}px;
    justify-content: space-between;
    min-width: 240px;
    padding: ${space.xxs}px ${space.xs}px;
`;

interface OptionDescriptor {
    value: GlassIntensityPreference;
    labelKey: keyof typeof microcopy.settings;
}

/*
 * Source of truth for the order options render in. "Auto" leads
 * because it's the default + the recommended choice; the other three
 * descend by translucency so the slider-feel matches the visual
 * progression on screen.
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
        (value: string | number) => {
            // Narrow the Segmented onChange signature (string|number)
            // back to the slice's union. The descriptor table above
            // pins every emitted value to a `GlassIntensityPreference`
            // member, so this narrowing is total in practice.
            const next = value as GlassIntensityPreference;
            dispatch(userPreferencesActions.setGlassIntensity(next));
        },
        [dispatch]
    );

    const options = OPTIONS.map((entry) => ({
        label: microcopy.settings[entry.labelKey] as string,
        value: entry.value
    }));

    return (
        <Row role="group" aria-label={microcopy.settings.changeGlassIntensity}>
            <Typography.Text>
                {microcopy.settings.glassIntensity}
            </Typography.Text>
            <Segmented
                aria-label={microcopy.settings.changeGlassIntensity}
                options={options}
                size="small"
                value={intensity}
                onChange={handleChange}
            />
        </Row>
    );
};

export default GlassIntensitySelect;
