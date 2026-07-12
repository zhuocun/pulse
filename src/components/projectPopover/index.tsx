import { ChevronDown, FolderOpen } from "lucide-react";
import { useNavigate } from "react-router";

import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import usePrefetchProject from "../../utils/hooks/usePrefetchProject";
import useProjectModal from "../../utils/hooks/useProjectModal";
import useReactQuery from "../../utils/hooks/useReactQuery";
import { NoPaddingButton } from "../projectList";

/**
 * Lightweight project switcher used inside the project detail breadcrumb.
 *
 * The trigger is a real `<button>` (not a bare `<span>`) so it is keyboard
 * focusable and announces correctly to screen readers; popover placement
 * defaults to `bottom-start` so it does not clip on narrow viewports.
 *
 * `leading-none` and small symmetric padding keep the trigger's visual
 * height aligned with the rest of the breadcrumb items (the separator,
 * the project name) so the row reads as a single baseline. Touch hit
 * area is expanded via padding under `(pointer: coarse)` rather than a
 * forced `min-height` that would push the trigger off the row centerline
 * on desktop.
 */
const ProjectPopover: React.FC = () => {
    const { openModal } = useProjectModal();
    const { data: projects } = useReactQuery<IProject[]>("projects");
    const navigate = useNavigate();
    /*
     * Prefetch-on-hover (ui-todo §2.A.7 / §9). Warm the board + tasks
     * queries for the switcher entry the user is pointing at / focusing,
     * exactly as the project cards do. Same hook → same query keys and
     * fetchers the board route consumes, and the same once-per-id guard,
     * so a flick through the switcher list doesn't spam the network.
     */
    const prefetchProject = usePrefetchProject();

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    aria-haspopup="menu"
                    aria-label={microcopy.a11y.switchProject}
                    className={cn(
                        "inline-flex items-center gap-xs whitespace-nowrap rounded-sm px-xs py-xxs font-medium leading-none text-foreground",
                        "cursor-pointer border-0 bg-transparent transition-colors",
                        "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                        "coarse:min-h-[44px] coarse:px-sm coarse:py-xs"
                    )}
                    type="button"
                >
                    <FolderOpen aria-hidden className="size-4" />
                    {microcopy.projectsPage.title}
                    <ChevronDown aria-hidden className="size-2.5 opacity-60" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="max-h-[60dvh] min-w-[min(18rem,calc(100dvw-32px))] max-w-[min(22rem,calc(100dvw-32px))] w-auto overflow-y-auto overscroll-contain p-sm"
                side="bottom"
            >
                <span className="text-xs font-semibold text-muted-foreground">
                    {microcopy.projectsPage.title}
                </span>
                <div className="mt-xs grid gap-[2px]">
                    {projects?.map((project) => (
                        <NoPaddingButton
                            className="flex h-auto w-full items-center justify-start rounded-sm px-sm py-xs text-left font-medium hover:bg-muted focus-visible:bg-muted"
                            key={project._id}
                            onClick={() =>
                                navigate(`/projects/${project._id}`, {
                                    viewTransition: true
                                })
                            }
                            onFocus={() => prefetchProject(project._id)}
                            onMouseEnter={() => prefetchProject(project._id)}
                            type="text"
                        >
                            {project.projectName}
                        </NoPaddingButton>
                    ))}
                </div>
                <Separator className="my-sm" />
                <NoPaddingButton onClick={openModal} type="link">
                    {microcopy.actions.createProject}
                </NoPaddingButton>
            </PopoverContent>
        </Popover>
    );
};

export default ProjectPopover;
