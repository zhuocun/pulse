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
import { radius, space } from "../../theme/tokens";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
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
 *
 * Width handling — six options + swatches + text are wider than a phone.
 * Two narrow surfaces are at play and each gets its own treatment so the
 * control never spills past its card:
 *   - Coarse-pointer phone chassis (`useIsPhoneChrome`): the picker lives
 *     in a single-line `SettingsRow` whose trailing slot does NOT shrink,
 *     so labels can't fit. We hide the hue TEXT (kept in the DOM as a
 *     screen-reader-only span — the swatch already conveys the colour
 *     visually) so six compact swatches fit the row.
 *   - Narrow fine-pointer desktop window: the desktop `Card` row stretches
 *     the control full-width, so the labelled control can exceed the card.
 *     The `Scroller` wrapper caps it at the card width and scrolls
 *     horizontally rather than overflowing.
 */

const Swatch = styled.span`
    border-radius: ${radius.xs}px;
    box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.18);
    display: inline-block;
    flex: 0 0 auto;
    height: 12px;
    width: 12px;
`;

/*
 * Each option is a swatch + hue label. On the coarse-pointer phone the
 * label text collapses to a visually-hidden (but screen-reader-readable)
 * span so the six options fit a single grouped-table row; the swatch
 * stays visible as the colour cue.
 */
const OptionLabel = styled.span<{ $compact: boolean }>`
    align-items: center;
    display: inline-flex;
    gap: ${space.xxs}px;

    .ct-name {
        ${(p) =>
            p.$compact
                ? `border: 0;
                   clip: rect(0 0 0 0);
                   height: 1px;
                   margin: -1px;
                   overflow: hidden;
                   padding: 0;
                   position: absolute;
                   white-space: nowrap;
                   width: 1px;`
                : ""}
    }
`;

/*
 * Caps the control at the available width and scrolls horizontally when
 * the labelled six-option Segmented can't fit (narrow desktop windows
 * where the Card row stretches the control full-width). On roomy widths
 * the Segmented is narrower than this and no scrollbar appears.
 */
const Scroller = styled.div`
    max-width: 100%;
    overflow-x: auto;
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
    sky: "colorThemeSky",
    emerald: "colorThemeEmerald"
};

const ColorThemeSelect = () => {
    const dispatch = useReduxDispatch() as ReduxDispatch;
    const isPhone = useIsPhoneChrome();
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

    const options = paletteNames.map((name) => {
        const text = microcopy.settings[LABEL_KEYS[name]] as string;
        return {
            value: name,
            label: (
                <OptionLabel $compact={isPhone}>
                    <Swatch
                        aria-hidden
                        style={{ background: getPalette(name).brand.primary }}
                    />
                    <span className="ct-name">{text}</span>
                </OptionLabel>
            )
        };
    });

    return (
        <Scroller role="group" aria-label={microcopy.settings.changeColorTheme}>
            <Segmented
                aria-label={microcopy.settings.changeColorTheme}
                options={options}
                size="small"
                value={colorTheme}
                onChange={handleChange}
            />
        </Scroller>
    );
};

export default ColorThemeSelect;
