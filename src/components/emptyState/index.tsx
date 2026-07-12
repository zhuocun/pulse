import React from "react";

import { cn } from "@/lib/utils";
import { Typography } from "@/components/ui/typography";

import { accent } from "../../theme/tokens";
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
 *    initial mount) is sufficient context.
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
    // `role="status"`; `error` escalates to assertive; `notice`/`notFound`
    // drop the live-region role entirely.
    const role =
        tone === "error"
            ? "alert"
            : POLITE_TONES.has(tone)
              ? "status"
              : undefined;
    return (
        <div
            className={cn(
                "flex flex-col items-center gap-sm px-md py-xl text-center text-foreground",
                "min-[480px]:px-lg min-[480px]:py-xxl"
            )}
            data-testid={testId}
            role={role}
        >
            {illustration ?? (
                <span
                    className="inline-flex size-[88px] items-center justify-center rounded-pill border border-border text-primary"
                    style={{
                        background: `radial-gradient(circle at 30% 30%, ${accent.bgMedium}, transparent 65%), radial-gradient(circle at 70% 70%, rgba(234, 88, 12, 0.16), transparent 60%), rgba(15, 23, 42, 0.04)`
                    }}
                >
                    <EmptyIllustration size={44} variant={variant} />
                </span>
            )}
            <Typography.Title
                className="m-0 text-md font-semibold leading-snug"
                level={headingLevel}
            >
                {title}
            </Typography.Title>
            {description ? (
                <Typography.Text
                    className="max-w-[36rem] leading-normal"
                    type="secondary"
                >
                    {description}
                </Typography.Text>
            ) : null}
            {cta ? <div className="mt-xs">{cta}</div> : null}
        </div>
    );
};

export default EmptyState;
