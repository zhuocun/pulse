import { ChevronDown, Users } from "lucide-react";

import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import useMembersList from "../../utils/hooks/useMembersList";
import EmptyState from "../emptyState";
import UserAvatar from "../userAvatar";

const MemberPopover: React.FC = () => {
    const { data: members } = useMembersList();

    const list = members ?? [];
    const previewMembers = list.slice(0, 3);

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    aria-label={microcopy.a11y.viewTeamMembers}
                    className={cn(
                        "inline-flex min-h-[32px] items-center gap-xs whitespace-nowrap rounded-md px-sm py-xxs font-medium text-foreground",
                        "cursor-pointer border-0 bg-transparent ring-offset-background transition-colors",
                        "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        "coarse:min-h-[44px]"
                    )}
                    type="button"
                >
                    <Users aria-hidden className="size-4" />
                    <span className="hidden sm:inline">
                        {microcopy.labels.members}
                    </span>
                    <span
                        aria-hidden
                        className="inline-flex items-center gap-xs"
                    >
                        <span className="flex items-center -space-x-2">
                            {previewMembers.map((member) => (
                                <UserAvatar
                                    className="ring-2 ring-card"
                                    id={member._id}
                                    key={member._id}
                                    name={member.username}
                                    size="small"
                                />
                            ))}
                        </span>
                        <span className="inline-flex min-w-[24px] items-center justify-center rounded-full bg-muted px-xs py-[2px] text-xs font-semibold leading-none text-muted-foreground">
                            {list.length}
                        </span>
                    </span>
                    <ChevronDown aria-hidden className="size-2.5 opacity-60" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="max-h-[60dvh] min-w-[min(20rem,calc(100dvw-32px))] max-w-[min(30rem,calc(100dvw-32px))] w-auto overflow-y-auto overscroll-contain"
                side="bottom"
            >
                <span className="mb-xs block text-xs font-semibold text-muted-foreground">
                    {microcopy.labels.teamMembers}
                </span>
                {list.length === 0 ? (
                    <EmptyState
                        title={microcopy.empty.members.title}
                        description={microcopy.empty.members.description}
                    />
                ) : (
                    <ul className="flex flex-col">
                        {list.map((member) => (
                            <li
                                className="flex items-center gap-sm py-xs"
                                key={member._id}
                            >
                                <UserAvatar
                                    id={member._id}
                                    name={member.username}
                                    size="small"
                                />
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm font-medium text-foreground">
                                        {member.username}
                                    </span>
                                    <span className="truncate text-xs text-muted-foreground">
                                        {member.email}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </PopoverContent>
        </Popover>
    );
};

export default MemberPopover;
