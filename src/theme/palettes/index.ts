/**
 * Palette registry + active-palette default.
 *
 * The app ships three contrast-verified palettes. ONE of them (orange) is the
 * module-load default exported as `palette` — the synchronous CSS-var
 * injection in `index.tsx`, the literal fallbacks in `tokens.ts` /
 * `aiTokens.ts`, and the default `buildAntdTheme` argument all read it so the
 * very first paint is correct before React (and the runtime resolver hook)
 * mount. The user's stored `colorTheme` preference re-colors the live app at
 * runtime via `usePaletteTheme`, which re-renders `paletteToCss(selected)`
 * into the `#pulse-theme-vars` style element and rebuilds the AntD theme.
 *
 * Adding a palette:
 *   1. Add `palettes/<name>.ts` modeled on `orange.ts`.
 *   2. Import it below and add it to `paletteRegistry` in display order.
 *   3. Add its i18n hue label + the settings picker picks it up automatically.
 *
 * CRITICAL: this module must NOT import `tokens.ts`. The chain
 * `tokens → palettes/index → cssVars` would loop back through this re-export
 * and partially-initialise the `palette` const at module-load time (silent
 * breakage in every downstream consumer). See the cycle docblock in
 * `cssVars.ts`.
 */
import { emeraldPalette } from "./emerald";
import { orangePalette } from "./orange";
import { skyPalette } from "./sky";
import type { Palette } from "./types";

export { paletteToCss } from "./cssVars";
export { orangePalette as palette } from "./orange";
export type { Palette } from "./types";

/**
 * The default color theme. Orange is the historical brand, so existing users
 * who never opt in stay on it (no schema-version bump — see
 * `userPreferencesSlice`). Also the fallback `getPalette` returns for any
 * unknown stored name.
 */
export const defaultPaletteName = "orange" as const;

/**
 * The registry — insertion order IS the display order in the settings picker
 * (orange, sky, emerald). The key is the persisted `colorTheme` value; the
 * value is the palette object the runtime resolver and AntD builder consume.
 */
export const paletteRegistry = {
    orange: orangePalette,
    sky: skyPalette,
    emerald: emeraldPalette
} as const;

export type PaletteName = keyof typeof paletteRegistry;

export const paletteNames = Object.keys(paletteRegistry) as PaletteName[];

/**
 * Resolve a (possibly untrusted) palette name to its palette object. Falls
 * back to the orange default for any unknown name so a stale / hand-edited
 * `colorTheme` value can never strand the app without a palette.
 */
export const getPalette = (name: string): Palette =>
    paletteRegistry[name as PaletteName] ?? orangePalette;
