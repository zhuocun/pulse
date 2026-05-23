import styled from "@emotion/styled";
import { Typography } from "antd";
import React from "react";

import {
    accent,
    breakpoints,
    fontSize,
    fontWeight,
    lineHeight,
    radius,
    space
} from "../../theme/tokens";
import EmptyIllustration from "../emptyIllustration";

/**
 * Tone selects the ARIA semantics of the surface:
 *  - `empty` (default) and `loading` mount with `role="status"` so AT
 *    politely announces "no items yet" / "loading" when the surface
 *    appears mid-flow (search results, just-emptied list).
 *  - `error` mounts with `role="alert"` for assertive announcement —
 *    use when something failed and the user needs to know now.
 *  - `notice` and `notFound` mount with no live-region role; the
 *    heading itself carries the message and the page change (or
 *    initial mount) is sufficient context. Avoids the gratuitous
 *    polite-live-region announcement on every 404 / AI-disabled
 *    landing.
 */
type EmptyStateTone = "empty" | "loading" | "notice" | "notFound" | "error";

interface EmptyStateProps {
    title: string;
    description?: React.ReactNode;
    cta?: React.ReactNode;
    illustration?: React.ReactNode;
    /** Selects which branded illustration to show when no override is passed. */
    variant?: "tasks" | "projects" | "search" | "members";
    /**
     * Heading level for the title (1-5). Defaults to 5 for backwards
     * compatibility, but callers should pass the level that keeps their
     * page outline contiguous (h1 → h2 on the project list, h2 → h3
     * inside a column).
     */
    headingLevel?: 1 | 2 | 3 | 4 | 5;
    /**
     * ARIA-tone of the surface. Defaults to `"empty"` (role=status, same
     * as the prior unconditional behavior) so existing callsites keep
     * announcing. Pass `"notFound"` / `"notice"` for surfaces that
     * shouldn't trigger a live-region announcement on every mount, or
     * `"error"` for assertive announcement.
     */
    tone?: EmptyStateTone;
    "data-testid"?: string;
}

/* Tones that should fire a polite live-region announcement on mount. */
const POLITE_TONES = new Set<EmptyStateTone>(["empty", "loading"]);

const Container = styled.div`
    align-items: center;
    color: var(--ant-color-text, rgba(15, 23, 42, 0.85));
    display: flex;
    flex-direction: column;
    gap: ${space.sm}px;
    padding: ${space.xl}px ${space.md}px;
    text-align: center;

    @media (min-width: ${breakpoints.sm}px) {
        padding: ${space.xxl}px ${space.lg}px;
    }
`;

const IllustrationFrame = styled.div`
    align-items: center;
    background:
        radial-gradient(circle at 30% 30%, ${accent.bgMedium}, transparent 65%),
        radial-gradient(
            circle at 70% 70%,
            rgba(234, 88, 12, 0.16),
            transparent 60%
        ),
        var(--ant-color-fill-quaternary, rgba(15, 23, 42, 0.04));
    border: 1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.06));
    border-radius: ${radius.pill}px;
    color: var(--ant-color-primary, #ea580c);
    display: inline-flex;
    height: 88px;
    justify-content: center;
    margin-bottom: 0;
    width: 88px;
`;

const Title = styled(Typography.Title)`
    && {
        font-size: ${fontSize.md}px;
        font-weight: ${fontWeight.semibold};
        line-height: ${lineHeight.snug};
        margin: 0;
    }
`;

const Description = styled(Typography.Text)`
    && {
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
        line-height: ${lineHeight.normal};
        max-width: 36rem;
    }
`;

/**
 * Reusable empty state used by project list, board, members popover, chat
 * drawer, brief drawer (Phase 3.6). Keeps the visual treatment, copy density,
 * and CTA placement consistent.
 */
const EmptyState: React.FC<EmptyStateProps> = ({
    title,
    description,
    cta,
    illustration,
    variant = "tasks",
    headingLevel = 5,
    tone = "empty",
    "data-testid": testId
}) => {
    // Map tone → ARIA role. `empty`/`loading` keep the prior
    // `role="status"` so existing callsites continue to announce
    // politely; `error` escalates to assertive; `notice`/`notFound`
    // drop the live-region role entirely.
    const role =
        tone === "error"
            ? "alert"
            : POLITE_TONES.has(tone)
              ? "status"
              : undefined;
    return (
        <Container data-testid={testId} role={role}>
            {illustration ?? (
                <IllustrationFrame>
                    <EmptyIllustration size={44} variant={variant} />
                </IllustrationFrame>
            )}
            <Title level={headingLevel}>{title}</Title>
            {description ? <Description>{description}</Description> : null}
            {cta ? <div style={{ marginTop: space.xs }}>{cta}</div> : null}
        </Container>
    );
};

export default EmptyState;
