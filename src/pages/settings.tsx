import styled from "@emotion/styled";
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
import {
    breakpoints,
    fontSize,
    fontWeight,
    lineHeight,
    radius,
    space
} from "../theme/tokens";
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

const PageHeading = styled(Typography.Title)`
    && {
        font-size: ${fontSize.xxl}px;
        font-weight: ${fontWeight.semibold};
        line-height: ${lineHeight.tight};
        margin-bottom: ${space.xs}px;
    }
`;

const PageSubtitle = styled(Typography.Paragraph)`
    && {
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
        font-size: ${fontSize.md}px;
        margin-bottom: ${space.xl}px;
    }
`;

const SettingsList = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${space.md}px;
    margin-inline: auto;
    max-width: 48rem;
    width: 100%;
`;

/*
 * Settings row layout follows the iOS 26 "grouped table view" idiom:
 * on roomy viewports (>=sm) the label sits inline with the control on
 * the right, separated by `space-between`. Below `sm` the row stacks
 * — label on top, control stretched full-width below — because at
 * iPhone-width (393 px) the Theme row's 3-state toggle group (and to a
 * lesser extent the Language row's toggle group) couldn't fit alongside
 * the label and was forcing the label ("Them\ne") and the option
 * pills ("Li…", "D…", "Syst…") to ellipsize. Stacking is applied
 * uniformly to every row so the four controls feel cut from the same
 * cloth on phone, not three-cards-aligned-one-stacked. The inner
 * `RowLabel` keeps `flex: 1 1 auto` so the desktop branch still
 * pushes the control to the trailing edge; the stacked branch
 * stretches both children full-width via `align-items: stretch`.
 */
const Row = styled(Card)`
    && {
        align-items: stretch;
        border-radius: ${radius.lg}px;
        display: flex;
        flex-direction: column;
        gap: ${space.sm}px;
        padding: ${space.md}px ${space.lg}px;
    }
    @media (min-width: ${breakpoints.sm}px) {
        && {
            align-items: center;
            flex-direction: row;
            gap: ${space.md}px;
            justify-content: space-between;
        }
    }
`;

const RowLabel = styled.div`
    align-items: center;
    display: flex;
    flex: 1 1 auto;
    gap: ${space.xs}px;
    min-width: 0;
`;

const RowText = styled(Typography.Text)`
    && {
        font-size: ${fontSize.md}px;
        font-weight: ${fontWeight.medium};
    }
`;

/*
 * Phone-only disclosure for the colour-theme picker. A native
 * `<details>`/`<summary>` gives keyboard + screen-reader-correct
 * expand/collapse for free (replacing the antd ghost `Collapse`); the
 * default marker is hidden in favour of a trailing chevron that rotates
 * open, matching the grouped-table idiom of the surrounding rows.
 */
const ColorThemeDisclosure = styled.details`
    & > summary {
        align-items: center;
        cursor: pointer;
        display: flex;
        gap: ${space.xs}px;
        justify-content: space-between;
        list-style: none;
        min-height: 44px;
        padding: ${space.sm}px 0;
    }

    & > summary::-webkit-details-marker {
        display: none;
    }

    & > summary .disclosure-chevron {
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
        height: 16px;
        transition: transform 150ms ease;
        width: 16px;
    }

    &[open] > summary .disclosure-chevron {
        transform: rotate(90deg);
    }

    & > div {
        padding-bottom: ${space.sm}px;
    }
`;

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
                <PageHeading level={1}>
                    {microcopy.settings.pageTitle}
                </PageHeading>
                <PageSubtitle>{microcopy.settings.pageSubtitle}</PageSubtitle>
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
                    <ColorThemeDisclosure data-testid="settings-color-theme-collapse">
                        <summary>
                            <span>{microcopy.settings.colorTheme}</span>
                            <ChevronRight
                                aria-hidden
                                className="disclosure-chevron"
                            />
                        </summary>
                        <div>{colorThemeControl}</div>
                    </ColorThemeDisclosure>
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
            <PageHeading level={1}>{microcopy.settings.pageTitle}</PageHeading>
            <PageSubtitle>{microcopy.settings.pageSubtitle}</PageSubtitle>
            <SettingsList>
                <Row data-testid="settings-row-theme">
                    <RowLabel>
                        {themeIcon}
                        <RowText>{microcopy.settings.theme}</RowText>
                    </RowLabel>
                    {themeControl}
                </Row>
                <Row data-testid="settings-row-language">
                    <RowLabel>
                        {languageIcon}
                        <RowText>{microcopy.settings.language}</RowText>
                    </RowLabel>
                    {languageControl}
                </Row>
                <Row data-testid="settings-row-color-theme">
                    <RowLabel>
                        {colorThemeIcon}
                        <RowText>{microcopy.settings.colorTheme}</RowText>
                    </RowLabel>
                    {colorThemeControl}
                </Row>
                {aiAvailable ? (
                    <Row data-testid="settings-row-ai">
                        <RowLabel>
                            {copilotIcon}
                            <RowText>{microcopy.settings.aiEnabled}</RowText>
                        </RowLabel>
                        {aiControl}
                    </Row>
                ) : null}
                <Row data-testid="settings-row-logout">
                    <RowLabel>
                        {logoutIcon}
                        <RowText>{microcopy.actions.logOut}</RowText>
                    </RowLabel>
                    {logoutControl}
                </Row>
            </SettingsList>
        </PageContainer>
    );
};

export default SettingsPage;
