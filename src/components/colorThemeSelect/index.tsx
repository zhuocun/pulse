import styled from "@emotion/styled";
import { Segmented } from "antd";
import { useCallback } from "react";

import { microcopy } from "../../constants/microcopy";
import type { ReduxDispatch, RootState } from "../../store";
import {
    userPreferencesActions,
    type ColorThemePreference
} from "../../store/reducers/userPreferencesSlice";
import { getPalette, paletteNames } from "../../theme/palettes";
import { radius } from "../../theme/tokens";
import { useReduxDispatch, useReduxSelector } from "../../utils/hooks/useRedux";

/**
 * Runtime colour-theme picker. Surfaces the six shipped palettes from the
 * registry as a Segmented control. Reads `userPreferences.colorTheme` and
 * writes via `setColorTheme`; the slice persists through the store
 * middleware so the choice round-trips through localStorage automatically,
 * and `usePaletteTheme` (mounted in `ThemedShell`) re-colors the whole app
 * on the next layout effect.
 *
 * The options are derived from `paletteNames` in registry insertion order
 * (orange, rose, violet, indigo, cyan, emerald) so adding a palette
 * extends the picker without editing this component — the only per-palette
 * touchpoints are the registry and the i18n hue labels. Each option shows
 * a small swatch tinted with that palette's `brand.primary` so the hue is
 * legible at a glance, not just by name.
 *
 * Unlike `GlassIntensitySelect`, this renders ONLY the Segmented (no
 * leading text label) — the Settings page rows (`SettingsRow` on phone,
 * the `Card` Row on desktop) already supply the "Color theme" label + icon,
 * so an internal label would duplicate it. The `role="group"` + aria-label
 * keep the control self-describing for screen readers.
 */

const Swatch = styled.span`
    border-radius: ${radius.xs}px;
    box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.18);
    display: inline-block;
    height: 12px;
    width: 12px;
`;

/*
 * Map each palette name to its i18n hue label key. The keys live in the
 * `settings` microcopy block (`colorThemeOrange` … `colorThemeEmerald`);
 * keeping the lookup table here — rather than templating the key — lets
 * TypeScript verify every name maps to a real microcopy key and keeps a
 * grep for the literal landing on the dictionary entry.
 */
const LABEL_KEYS: Record<
    ColorThemePreference,
    keyof typeof microcopy.settings
> = {
    orange: "colorThemeOrange",
    rose: "colorThemeRose",
    violet: "colorThemeViolet",
    indigo: "colorThemeIndigo",
    cyan: "colorThemeCyan",
    emerald: "colorThemeEmerald"
};

const ColorThemeSelect = () => {
    const dispatch = useReduxDispatch() as ReduxDispatch;
    const colorTheme = useReduxSelector<ColorThemePreference>(
        (state: RootState) => state.userPreferences.colorTheme
    );

    const handleChange = useCallback(
        (value: string | number) => {
            // Narrow the Segmented onChange signature (string|number)
            // back to the slice's union. Every emitted value comes from
            // `paletteNames`, which IS the `ColorThemePreference` space,
            // so the narrowing is total in practice.
            dispatch(
                userPreferencesActions.setColorTheme(
                    value as ColorThemePreference
                )
            );
        },
        [dispatch]
    );

    const options = paletteNames.map((name) => ({
        label: microcopy.settings[LABEL_KEYS[name]] as string,
        value: name,
        icon: (
            <Swatch
                aria-hidden
                style={{ background: getPalette(name).brand.primary }}
            />
        )
    }));

    return (
        <span role="group" aria-label={microcopy.settings.changeColorTheme}>
            <Segmented
                aria-label={microcopy.settings.changeColorTheme}
                options={options}
                size="small"
                value={colorTheme}
                onChange={handleChange}
            />
        </span>
    );
};

export default ColorThemeSelect;
