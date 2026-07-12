import { useCallback } from "react";

import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { microcopy } from "../../constants/microcopy";
import type { ReduxDispatch, RootState } from "../../store";
import {
    userPreferencesActions,
    type ColorThemePreference
} from "../../store/reducers/userPreferencesSlice";
import { getPalette, paletteNames } from "../../theme/palettes";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import { useReduxDispatch, useReduxSelector } from "../../utils/hooks/useRedux";

/**
 * Runtime colour-theme picker. Surfaces the shipped palettes from the
 * registry as a ToggleGroup (single-select). Reads
 * `userPreferences.colorTheme` and writes via `setColorTheme`; the slice
 * persists through the store middleware so the choice round-trips through
 * localStorage automatically, and `usePaletteTheme` (mounted in
 * `ThemedShell`) re-colors the whole app on the next layout effect.
 *
 * The options are derived from `paletteNames` in registry insertion order
 * so adding a palette extends the picker without editing this component.
 * Each option shows a small swatch tinted with that palette's
 * `brand.primary` so the hue is legible at a glance, not just by name.
 *
 * Unlike `GlassIntensitySelect`, this renders ONLY the control (no leading
 * text label) — the Settings page rows already supply the "Color theme"
 * label + icon. The `role="group"` + aria-label keep the control
 * self-describing for screen readers.
 *
 * Width handling — on the coarse-pointer phone chassis the hue TEXT
 * collapses to a screen-reader-only span (the swatch already conveys the
 * colour visually) so the options fit a single grouped-table row; the
 * scroller caps the labelled control at the card width on narrow desktop.
 */

/*
 * Map each palette name to its i18n hue label key. Keeping the lookup
 * table here — rather than templating the key — lets TypeScript verify
 * every name maps to a real microcopy key and keeps a grep for the literal
 * landing on the dictionary entry.
 */
const LABEL_KEYS: Record<
    ColorThemePreference,
    keyof typeof microcopy.settings
> = {
    orange: "colorThemeOrange",
    blue: "colorThemeBlue",
    emerald: "colorThemeEmerald"
};

const ColorThemeSelect = () => {
    const dispatch = useReduxDispatch() as ReduxDispatch;
    const isPhone = useIsPhoneChrome();
    const colorTheme = useReduxSelector<ColorThemePreference>(
        (state: RootState) => state.userPreferences.colorTheme
    );

    const handleChange = useCallback(
        (value: string) => {
            // Guard the toggle-off case (Radix single-select emits "" when
            // the active item is re-pressed); Segmented never deselects, so
            // ignore an empty value to keep exactly one palette selected.
            if (!value) return;
            dispatch(
                userPreferencesActions.setColorTheme(
                    value as ColorThemePreference
                )
            );
        },
        [dispatch]
    );

    return (
        <div
            aria-label={microcopy.settings.changeColorTheme}
            className="max-w-full overflow-x-auto"
            role="group"
        >
            <ToggleGroup
                aria-label={microcopy.settings.changeColorTheme}
                onValueChange={handleChange}
                size="sm"
                type="single"
                value={colorTheme}
            >
                {paletteNames.map((name) => {
                    const text = microcopy.settings[LABEL_KEYS[name]] as string;
                    return (
                        <ToggleGroupItem key={name} value={name}>
                            <span className="inline-flex items-center gap-xxs">
                                <span
                                    aria-hidden
                                    className="inline-block size-3 flex-none rounded-xs shadow-[inset_0_0_0_1px_rgba(15,23,42,0.18)]"
                                    style={{
                                        background:
                                            getPalette(name).brand.primary
                                    }}
                                />
                                <span className={cn(isPhone && "sr-only")}>
                                    {text}
                                </span>
                            </span>
                        </ToggleGroupItem>
                    );
                })}
            </ToggleGroup>
        </div>
    );
};

export default ColorThemeSelect;
