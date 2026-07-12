import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Typography } from "@/components/ui/typography";

import { microcopy } from "../../constants/microcopy";
import { useLocale, type LocaleCode } from "../../i18n";

/**
 * Compact language switcher for use inside the account dropdown.
 *
 * Renders the localized language label on the left and a ToggleGroup on
 * the right. Each segment shows the language's *native* name ("English",
 * "中文") so the option you want to switch to is always readable in its own
 * script — a common i18n best practice (no one looking for Chinese knows
 * that "Chinese" is the right English label).
 *
 * Selecting a segment writes through `useLocale().setLocale`, which:
 *   1. Updates the active dictionary singleton synchronously so any error
 *      thrown later in the same tick already speaks the new language.
 *   2. Persists the choice to localStorage and updates `<html lang>`.
 *   3. Forces a remount of the LanguageProvider subtree so static
 *      `microcopy` reads pick up the new strings on the next paint.
 */
const LanguageSwitcher = () => {
    const { locale, availableLocales, setLocale } = useLocale();

    return (
        <div
            aria-label={microcopy.settings.changeLanguage}
            className="flex min-w-[240px] items-center justify-between gap-sm px-xs py-xxs"
            role="group"
        >
            <Typography.Text>{microcopy.settings.language}</Typography.Text>
            <ToggleGroup
                aria-label={microcopy.settings.changeLanguage}
                onValueChange={(value) => {
                    // Radix single-select emits "" when the active item is
                    // re-pressed; ignore it so a locale stays selected.
                    if (value) setLocale(value as LocaleCode);
                }}
                size="sm"
                type="single"
                value={locale}
            >
                {availableLocales.map((entry) => (
                    <ToggleGroupItem
                        key={entry.code}
                        title={entry.englishName}
                        value={entry.code}
                    >
                        {entry.nativeName}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </div>
    );
};

export default LanguageSwitcher;
