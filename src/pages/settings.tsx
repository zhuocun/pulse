import {
    DesktopOutlined,
    GlobalOutlined,
    LogoutOutlined,
    MoonOutlined,
    SunOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Card, Segmented, Space, Switch, Typography } from "antd";

import PageContainer from "../components/pageContainer";
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
`;

/*
 * Settings row layout follows the iOS 26 "grouped table view" idiom:
 * on roomy viewports (>=sm) the label sits inline with the control on
 * the right, separated by `space-between`. Below `sm` the row stacks
 * — label on top, control stretched full-width below — because at
 * iPhone-width (393 px) the Theme row's 3-state Segmented (and to a
 * lesser extent the Language row's Segmented) couldn't fit alongside
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
        border-radius: ${radius.lg}px;
    }
    && .ant-card-body {
        align-items: stretch;
        display: flex;
        flex-direction: column;
        gap: ${space.sm}px;
        padding: ${space.md}px ${space.lg}px;
    }
    @media (min-width: ${breakpoints.sm}px) {
        && .ant-card-body {
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
    gap: ${space.sm}px;
    min-width: 0;
`;

const RowText = styled(Typography.Text)`
    && {
        font-size: ${fontSize.md}px;
        font-weight: ${fontWeight.medium};
    }
`;

const SettingsPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.settings), false);
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

    return (
        <PageContainer>
            <PageHeading level={1}>{microcopy.settings.pageTitle}</PageHeading>
            <PageSubtitle>{microcopy.settings.pageSubtitle}</PageSubtitle>
            <SettingsList>
                <Row data-testid="settings-row-theme">
                    <RowLabel>
                        <Space size={space.xs}>
                            {scheme === "dark" ? (
                                <MoonOutlined aria-hidden />
                            ) : (
                                <SunOutlined aria-hidden />
                            )}
                            <RowText>{microcopy.settings.theme}</RowText>
                        </Space>
                    </RowLabel>
                    {/*
                     * 3-state Segmented preserves the underlying
                     * `useColorScheme()` contract (light / dark / system).
                     * The previous 2-state Switch collapsed `system` to
                     * either light or dark on toggle and left the user
                     * no way back to "follow OS" once they touched it.
                     * Aria-label stays on the wrapping group so screen
                     * readers announce the control purpose; each item
                     * carries its own visible label + icon.
                     */}
                    <Segmented
                        aria-label={microcopy.settings.theme}
                        options={[
                            {
                                label: microcopy.settings.themeLight,
                                value: "light",
                                icon: <SunOutlined aria-hidden />
                            },
                            {
                                label: microcopy.settings.themeDark,
                                value: "dark",
                                icon: <MoonOutlined aria-hidden />
                            },
                            {
                                label: microcopy.settings.themeSystem,
                                value: "system",
                                icon: <DesktopOutlined aria-hidden />
                            }
                        ]}
                        onChange={(value) =>
                            setPreference(value as "light" | "dark" | "system")
                        }
                        value={themePreference}
                    />
                </Row>
                <Row data-testid="settings-row-language">
                    <RowLabel>
                        <Space size={space.xs}>
                            <GlobalOutlined aria-hidden />
                            <RowText>{microcopy.settings.language}</RowText>
                        </Space>
                    </RowLabel>
                    {/* Native names ("English", "中文") so the option you
                     * want is always readable in its own script. */}
                    <Segmented
                        aria-label={microcopy.settings.changeLanguage}
                        options={availableLocales.map((entry) => ({
                            label: entry.nativeName,
                            value: entry.code,
                            title: entry.englishName
                        }))}
                        onChange={(value) => setLocale(value as LocaleCode)}
                        value={locale}
                    />
                </Row>
                {aiAvailable ? (
                    <Row data-testid="settings-row-ai">
                        <RowLabel>
                            <RowText>{microcopy.settings.aiEnabled}</RowText>
                        </RowLabel>
                        <Switch
                            aria-label={microcopy.settings.toggleBoardCopilot}
                            checked={aiEnabled}
                            onChange={setAiEnabled}
                        />
                    </Row>
                ) : null}
                <Row data-testid="settings-row-logout">
                    <RowLabel>
                        <Space size={space.xs}>
                            <LogoutOutlined aria-hidden />
                            <RowText>{microcopy.actions.logOut}</RowText>
                        </Space>
                    </RowLabel>
                    <Button
                        aria-label={microcopy.actions.logOut}
                        danger
                        onClick={() => {
                            logout();
                        }}
                    >
                        {microcopy.actions.logOut}
                    </Button>
                </Row>
            </SettingsList>
        </PageContainer>
    );
};

export default SettingsPage;
