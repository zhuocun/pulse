import {
    Bot,
    ChevronRight,
    Globe,
    LogOut,
    Monitor,
    Moon,
    Palette,
    Sun
} from "lucide-react";
import { type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Typography } from "@/components/ui/typography";
import ColorThemeSelect from "../components/colorThemeSelect";
import PageContainer from "../components/pageContainer";
import SettingsSection, { SettingsRow } from "../components/settingsSection";
import { microcopy } from "../constants/microcopy";
import { useLocale, type LocaleCode } from "../i18n";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";
import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

/**
 * Settings page (Phase 3 A3). Hosts the four controls that previously
 * lived inside the header account dropdown:
 *
 *   - Theme (dark mode) toggle
 *   - Language switcher
 *   - Board Copilot (AI) enabled toggle
 *   - Log out
 *
 * The header now demotes its right cluster on coarse pointers, so this
 * page is the canonical home for these controls on phone. Desktop
 * still reaches them via the header dropdown — both surfaces share the
 * same hooks (useColorScheme, useAiEnabled, useAuth) so a setting
 * change in one place is reflected in the other on next paint.
 *
 * Chassis split (Phase 6 Wave 5): on phone (`useIsPhoneChrome()`) the
 * four controls compose the iOS grouped-table primitives
 * (`SettingsSection` / `SettingsRow`) into three sections — Appearance,
 * Board Copilot, Account. On desktop the original `SettingsList` of
 * `Card` rows is kept verbatim. Both branches consume the same control
 * elements, computed once below, so the underlying widgets (and their
 * `aria-label`s) are identical regardless of chassis.
 */

/*
 * Desktop settings row. Follows the iOS 26 "grouped table view" idiom:
 * on roomy viewports (>=480px) the label sits inline with the control on
 * the right, separated by space-between. Below 480px the row stacks —
 * label on top, control stretched full-width below — because at
 * iPhone-width (393 px) the Theme row's 3-state toggle group couldn't fit
 * alongside the label and forced both to ellipsize.
 */
const SettingsRowCard = ({
    icon,
    label,
    control,
    "data-testid": dataTestid
}: {
    icon: ReactNode;
    label: ReactNode;
    control: ReactNode;
    "data-testid"?: string;
}) => (
    <Card
        className="flex flex-col items-stretch gap-sm px-lg py-md min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between min-[480px]:gap-md"
        data-testid={dataTestid}
    >
        <div className="flex min-w-0 flex-auto items-center gap-xs">
            {icon}
            <Typography.Text className="text-md font-medium">
                {label}
            </Typography.Text>
        </div>
        {control}
    </Card>
);

const SettingsPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.settings), false);
    const isPhone = useIsPhoneChrome();
    const { logout } = useAuth();
    const {
        available: aiAvailable,
        enabled: aiEnabled,
        setEnabled: setAiEnabled
    } = useAiEnabled();
    const {
        preference: themePreference,
        scheme,
        setPreference
    } = useColorScheme();
    const { locale, availableLocales, setLocale } = useLocale();

    /*
     * Controls, labels, and icons are built once so both chassis branches
     * render byte-identical widgets (same options, handlers, aria-labels);
     * only the surrounding shell (grouped sections vs. Card rows) differs.
     */
    const themeIcon =
        scheme === "dark" ? (
            <Moon aria-hidden className="size-4" />
        ) : (
            <Sun aria-hidden className="size-4" />
        );
    const languageIcon = <Globe aria-hidden className="size-4" />;
    const colorThemeIcon = <Palette aria-hidden className="size-4" />;
    const logoutIcon = <LogOut aria-hidden className="size-4" />;
    const copilotIcon = <Bot aria-hidden className="size-4" />;

    /*
     * 3-state toggle group preserves the underlying `useColorScheme()`
     * contract (light / dark / system). The previous 2-state Switch
     * collapsed `system` to either light or dark on toggle and left the
     * user no way back to "follow OS" once they touched it. Aria-label
     * stays on the wrapping group so screen readers announce the control
     * purpose; each item carries its own visible label + icon.
     */
    const themeControl = (
        <ToggleGroup
            aria-label={microcopy.settings.theme}
            onValueChange={(value) => {
                if (value) setPreference(value as "light" | "dark" | "system");
            }}
            type="single"
            value={themePreference}
        >
            <ToggleGroupItem value="light">
                <Sun aria-hidden />
                {microcopy.settings.themeLight}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark">
                <Moon aria-hidden />
                {microcopy.settings.themeDark}
            </ToggleGroupItem>
            <ToggleGroupItem value="system">
                <Monitor aria-hidden />
                {microcopy.settings.themeSystem}
            </ToggleGroupItem>
        </ToggleGroup>
    );

    /* The colour-theme picker owns its own slice read/dispatch +
     * toggle group (palette swatches), so the page just slots the
     * element into both chassis branches like any other control. */
    const colorThemeControl = <ColorThemeSelect />;

    /* Native names ("English", "中文") so the option you want is always
     * readable in its own script. */
    const languageControl = (
        <ToggleGroup
            aria-label={microcopy.settings.changeLanguage}
            onValueChange={(value) => {
                if (value) setLocale(value as LocaleCode);
            }}
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
    );

    const aiControl = (
        <Switch
            aria-label={microcopy.settings.toggleBoardCopilot}
            checked={aiEnabled}
            onCheckedChange={setAiEnabled}
        />
    );

    const logoutControl = (
        <Button
            aria-label={microcopy.actions.logOut}
            className="text-destructive hover:text-destructive"
            onClick={() => {
                logout();
            }}
            variant="ghost"
        >
            <LogOut aria-hidden />
            {microcopy.actions.logOut}
        </Button>
    );

    if (isPhone) {
        return (
            <PageContainer>
                <Typography.Title
                    className="mb-xs text-xxl font-semibold leading-tight"
                    level={1}
                >
                    {microcopy.settings.pageTitle}
                </Typography.Title>
                <Typography.Paragraph className="mb-xl text-md text-[color:var(--pulse-text-secondary)]">
                    {microcopy.settings.pageSubtitle}
                </Typography.Paragraph>
                <SettingsSection
                    data-testid="settings-section-appearance"
                    footer={microcopy.settings.sections.appearance.footer}
                    header={microcopy.settings.sections.appearance.header}
                >
                    <SettingsRow
                        control={themeControl}
                        data-testid="settings-row-theme"
                        icon={themeIcon}
                        label={microcopy.settings.theme}
                    />
                    <SettingsRow
                        control={languageControl}
                        data-testid="settings-row-language"
                        icon={languageIcon}
                        label={microcopy.settings.language}
                    />
                    {/*
                     * Phone-only disclosure for the colour-theme picker. A
                     * native `<details>`/`<summary>` gives keyboard +
                     * screen-reader-correct expand/collapse for free; the
                     * default marker is hidden in favour of a trailing
                     * chevron that rotates open, matching the grouped-table
                     * idiom of the surrounding rows.
                     */}
                    <details
                        className="group"
                        data-testid="settings-color-theme-collapse"
                    >
                        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-xs py-sm [&::-webkit-details-marker]:hidden">
                            <span>{microcopy.settings.colorTheme}</span>
                            <ChevronRight
                                aria-hidden
                                className="size-4 text-[color:var(--pulse-text-secondary)] transition-transform duration-[150ms] ease-[ease] group-open:rotate-90"
                            />
                        </summary>
                        <div className="pb-sm">{colorThemeControl}</div>
                    </details>
                </SettingsSection>
                {aiAvailable ? (
                    <SettingsSection
                        data-testid="settings-section-copilot"
                        footer={microcopy.settings.sections.copilot.footer}
                    >
                        <SettingsRow
                            control={aiControl}
                            data-testid="settings-row-ai"
                            icon={copilotIcon}
                            label={microcopy.settings.aiEnabled}
                        />
                    </SettingsSection>
                ) : null}
                <SettingsSection
                    data-testid="settings-section-account"
                    footer={microcopy.settings.sections.account.footer}
                    header={microcopy.settings.sections.account.header}
                >
                    <SettingsRow
                        data-testid="settings-row-logout"
                        destructive
                        icon={logoutIcon}
                        label={microcopy.actions.logOut}
                        onActivate={() => {
                            logout();
                        }}
                    />
                </SettingsSection>
            </PageContainer>
        );
    }

    return (
        <PageContainer>
            <Typography.Title
                className="mb-xs text-xxl font-semibold leading-tight"
                level={1}
            >
                {microcopy.settings.pageTitle}
            </Typography.Title>
            <Typography.Paragraph className="mb-xl text-md text-[color:var(--pulse-text-secondary)]">
                {microcopy.settings.pageSubtitle}
            </Typography.Paragraph>
            <div className="mx-auto flex w-full max-w-[48rem] flex-col gap-md">
                <SettingsRowCard
                    control={themeControl}
                    data-testid="settings-row-theme"
                    icon={themeIcon}
                    label={microcopy.settings.theme}
                />
                <SettingsRowCard
                    control={languageControl}
                    data-testid="settings-row-language"
                    icon={languageIcon}
                    label={microcopy.settings.language}
                />
                <SettingsRowCard
                    control={colorThemeControl}
                    data-testid="settings-row-color-theme"
                    icon={colorThemeIcon}
                    label={microcopy.settings.colorTheme}
                />
                {aiAvailable ? (
                    <SettingsRowCard
                        control={aiControl}
                        data-testid="settings-row-ai"
                        icon={copilotIcon}
                        label={microcopy.settings.aiEnabled}
                    />
                ) : null}
                <SettingsRowCard
                    control={logoutControl}
                    data-testid="settings-row-logout"
                    icon={logoutIcon}
                    label={microcopy.actions.logOut}
                />
            </div>
        </PageContainer>
    );
};

export default SettingsPage;
