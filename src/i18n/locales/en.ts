/**
 * English (en) dictionary — the structural baseline that every other
 * locale must satisfy.
 *
 * This file owns the literal strings: the type derived from
 * `typeof enSource` is the contract used by `Dictionary` (in `../types`),
 * the Chinese/future translations, and the runtime Proxy in
 * `src/constants/microcopy.ts`.
 *
 * Owning the literal here (rather than in `src/constants/microcopy.ts`)
 * keeps the i18n module self-contained and side-steps an otherwise
 * circular import — `microcopy.ts` reads the active dictionary through
 * `i18n/active.ts`, which seeds itself from this module.
 */
export const enSource = {
    actions: {
        addColumn: "Add column",
        apply: "Apply",
        askCopilot: "Ask Copilot",
        breakDown: "Break down",
        cancel: "Cancel",
        clear: "Clear",
        clearAiSearch: "Clear AI search",
        close: "Close",
        copyAsMarkdown: "Copy as markdown",
        create: "Create",
        createProject: "Create project",
        createTask: "Create task",
        delete: "Delete",
        draftTask: "Draft task",
        draftWithAi: "Draft with AI",
        edit: "Edit",
        editProject: "Edit project",
        editTask: "Edit task",
        logIn: "Log in",
        loggingIn: "Logging in…",
        logOut: "Log out",
        registerCta: "Sign up for an account",
        loginCta: "Log in to your account",
        refresh: "Refresh",
        resetFilters: "Reset filters",
        restore: "Restore",
        retry: "Retry",
        save: "Save",
        /*
         * Phase 4.2 — project-list saved defaults. "Save as default"
         * persists the current sort/filter as the user's preferred
         * project-list state (applied on first load when the URL is
         * empty). "Reset to default" restores the saved default;
         * separate from "Clear all" (which empties the URL state).
         */
        saveAsDefault: "Save as default",
        resetToDefault: "Reset to default",
        savedAsDefault: "Saved as default",
        defaultApplied: "Default applied",
        search: "Search",
        send: "Send",
        showPassword: "Show password",
        hidePassword: "Hide password",
        showReasoning: "Show reasoning",
        signUp: "Sign up",
        signingUp: "Signing up…",
        sort: "Sort",
        stop: "Stop",
        undo: "Undo"
    },
    validation: {
        emailRequired: "Please enter your email",
        emailInvalid: "Please enter a valid email address",
        passwordRequired: "Please enter your password",
        passwordTooShort: "Password must be at least 8 characters",
        usernameRequired: "Please enter your username",
        projectNameRequired: "Please enter the project name",
        organizationRequired: "Please enter the organization",
        managerRequired: "Please select a manager",
        coordinatorRequired: "Please select a coordinator",
        taskNameRequired: "Please enter the task name",
        taskTypeRequired: "Please select the task type"
    },
    a11y: {
        capsLockOn: "Caps Lock is on",
        loadingProject: "Loading project",
        loadingProjectName: "Loading project name",
        loadingBoard: "Loading board",
        accountMenu: "Account menu",
        accountMenuFor: "Account menu for {name}",
        boardCopilot: "Board Copilot",
        boardCopilotProjectToggle: "Board Copilot for this project",
        boardCopilotSettings: "Board Copilot settings",
        boardCopilotMenu: "Board Copilot menu",
        boardCopilotWelcome: "Board Copilot welcome",
        aboutBoardCopilot: "About Board Copilot",
        dismissSwipeHint: "Dismiss swipe hint",
        aiSuggestion: "AI suggestion",
        aiBadge: "AI · review before using",
        useDarkMode: "Switch to dark mode",
        useLightMode: "Switch to light mode",
        goToProjects: "Go to projects",
        skipToMainContent: "Skip to main content",
        members: "Members",
        viewTeamMembers: "View team members",
        switchProject: "Switch project",
        filterProjects: "Filter projects",
        filterTasks: "Filter tasks",
        activeFilters: "Active filters",
        removeFilter: "Remove {label} filter",
        sortProjects: "Sort projects",
        projectPagination: "Project list pages",
        favoritedOnlyToggle: "Show only favorited projects",
        saveCurrentAsDefault: "Save current filters as default",
        resetToSavedDefault: "Reset filters to saved default",
        loadingProjects: "Loading projects",
        loadingPage: "Loading page",
        projects: "Projects",
        searchProjectsByName: "Search projects by name",
        searchProjectsPending: "Filtering projects…",
        searchTasksByName: "Search tasks by name",
        filterByManager: "Filter by manager",
        filterByCoordinator: "Filter by coordinator",
        filterByType: "Filter by type",
        newColumnName: "New column name",
        newColumnCategory: "New column category",
        newTaskName: "New task name",
        taskPrompt: "Task prompt",
        breakdownAxisLabel: "Breakdown axis",
        draftTaskWithCopilot: "Draft task with Copilot",
        breakPromptIntoSubtasks: "Break the prompt into subtasks",
        creatingSubtasks: "Creating subtasks",
        subtaskBreakdown: "Subtask breakdown",
        includeSubtask: "Include subtask {name}",
        deleteTask: "Delete {name}",
        rejectProposal: "Reject proposal",
        acceptProposal: "Accept proposal",
        copyBriefAsMarkdown: "Copy brief as Markdown",
        generatingBrief: "Generating brief",
        boardBriefContent: "Board brief content",
        messageBoardCopilot: "Message Board Copilot",
        sendMessage: "Send message",
        samplePrompts: "Sample prompts",
        exitBoardCopilotMode: "Exit Board Copilot mode",
        switchToBoardCopilot: "Switch to Board Copilot",
        boardCopilotModeAnnouncement: "Board Copilot mode. Press Enter to ask.",
        openBoardCopilotBrief: "Open Board Copilot brief",
        openCopilotPanel: "Open Copilot panel",
        editMessage: "Edit message",
        copyResponse: "Copy response",
        regenerateResponse: "Regenerate response",
        helpfulAnswer: "Helpful answer",
        notHelpfulGiveFeedback: "Not helpful — give feedback",
        showAllSources: "Show all {count} sources",
        trySamplePrompt: "Try sample prompt: {prompt}",
        tryFollowUp: "Try follow-up: {prompt}",
        openTask: "Open task {name}",
        assignedTo: "Assigned to {name}",
        deleteColumnNamed: "Delete column {name}",
        moreActionsForColumn: "More actions for column {name}",
        moreActionsForProject: "More actions for {name}",
        likeProject: "Like {name}",
        unlikeProject: "Unlike {name}",
        applyReadinessSuggestion: "Apply readiness suggestion for {field}",
        lensChips: "Board lenses",
        lensComingSoon: "Coming soon",
        priorityTask: "Priority: {priority}",
        milestoneTask: "Milestone: {name}",
        overdueTask: "Overdue — was due {date}",
        blockedTask: "Blocked by an unfinished prerequisite task",
        completedTask: "Completed on {date}",
        renameTask: "Rename task",
        columnReadinessReady: "{ready} of {total} tasks ready",
        columnReadinessGrooming:
            "{ready} of {total} tasks ready — needs grooming",
        /*
         * QW#13 (2026-05 review §Quick Wins): the AiConfidenceIndicator
         * aria-label template. The numeric percentage *and* the plain-
         * language band (Low / Moderate / High) both ride in the label
         * so screen-reader users get the same paired signal sighted
         * users see in the visible chip.
         */
        confidenceAriaLabel: "Confidence {band}, {percent}"
    },
    dragHints: {
        taskCardKeyboard:
            "Keyboard drag: Space to lift, arrow keys to move, Space to drop, Escape to cancel.",
        columnDragHandle: "Drag to reorder column",
        reorderDisabledByFilters:
            "Reordering is paused while filters are active. Clear filters to reorder."
    },
    /*
     * Keyboard shortcut catalog (ui-todo §2.A.9). The dialog reads its
     * accessible name + scope headings from here; `descriptions.*` maps to
     * the stable shortcut ids in `src/constants/shortcuts.ts`. Scope labels
     * group the catalog in the help dialog.
     */
    shortcuts: {
        dialogTitle: "Keyboard shortcuts",
        dialogDescription: "Speed up your work with these keyboard shortcuts.",
        sequenceThen: "then",
        scopes: {
            global: "Global",
            projectPage: "Project page",
            board: "Board",
            taskCard: "Focused task card",
            overlay: "Modal & drawer"
        },
        descriptions: {
            openCommandPalette: "Open the command palette",
            openShortcutHelp: "Open keyboard shortcut help",
            goToProjects: "Go to projects",
            goToBoard: "Go to board",
            createTask: "Create a task in the focused column",
            closeOverlay: "Close the open modal or drawer",
            editTask: "Open the edit modal for the focused task",
            keyboardDragTask: "Drag the focused task with the keyboard"
        }
    },
    settings: {
        darkMode: "Dark mode",
        toggleDarkMode: "Toggle dark mode",
        boardCopilot: "Board Copilot",
        toggleBoardCopilot: "Enable Board Copilot features",
        language: "Language",
        changeLanguage: "Change language",
        theme: "Theme",
        themeLight: "Light",
        themeDark: "Dark",
        themeSystem: "System",
        aiEnabled: "Board Copilot",
        pageTitle: "Settings",
        pageSubtitle: "Choose your theme, language, and Copilot preferences.",
        /*
         * Phase 5 Wave 2 T4 — user-facing glass-intensity toggle. The
         * label sits beside a 4-option Segmented control in the account
         * dropdown. "Auto" defers to the per-device ladder (the default);
         * the other three are explicit overrides. Labels intentionally
         * short so they fit a single-line Segmented row inside the
         * narrow dropdown column.
         */
        glassIntensity: "Glass",
        changeGlassIntensity: "Change glass intensity",
        glassIntensityAuto: "Auto",
        glassIntensityClear: "Clear",
        glassIntensityRegular: "Regular",
        glassIntensitySolid: "Solid",
        /*
         * Runtime colour-theme picker. The label sits beside a 6-option
         * Segmented (one per shipped palette), each option showing a small
         * brand-primary swatch next to its single-word hue name. Orange is
         * the default; the rest re-color the whole app live. Hue labels are
         * deliberately single words to mirror the Light/Dark/System theme
         * convention and fit the 6-option control.
         */
        colorTheme: "Color theme",
        changeColorTheme: "Change color theme",
        colorThemeOrange: "Orange",
        colorThemeBlue: "Blue",
        colorThemeEmerald: "Emerald",
        sections: {
            appearance: {
                header: "Appearance",
                footer: "Theme and language apply across all your devices."
            },
            copilot: {
                footer: "Board Copilot uses AI to draft and break down work. Turn it off anytime."
            },
            account: {
                header: "Account",
                footer: "Sign out of Pulse on this device."
            }
        }
    },
    /**
     * Bottom tab bar (Phase 3 A3). Surfaces the four primary destinations
     * on `pointer: coarse` viewports. Labels stay short so the 25vw tab
     * width keeps the icon + label legible without truncation.
     */
    nav: {
        primaryLandmarkLabel: "Primary",
        desktopNavLabel: "Primary navigation",
        tabs: {
            boards: "Boards",
            inbox: "Inbox",
            copilot: "Copilot",
            profile: "Settings",
            search: "Search"
        }
    },
    inbox: {
        emptyTitle: "Your inbox is empty",
        emptyDescription:
            "Triage proposals, mentions, and AI activity will appear here.",
        heading: "Inbox",
        sections: {
            triage: {
                title: "Triage",
                empty: "No proposals to review right now. Board Copilot surfaces triage nudges on each board."
            },
            mentions: {
                title: "Mentions",
                empty: "No mentions yet.",
                // Accessible name for a mention row's "view task" link. The
                // consumer interpolates the mention summary so screen-reader
                // users hear what they're navigating to.
                viewTask: "View task",
                itemAriaLabel: "Mention: {summary}. View task."
            },
            activity: {
                title: "Activity"
            }
        }
    },
    /*
     * Phase 4.7 reports placeholder. The route is a "we hear you"
     * surface that establishes the URL + nav slot before the metrics
     * engine lands. Copy intentionally signals "soon, with your input"
     * rather than vague "coming soon" so users know the team is
     * listening for feature requests. Keep the description short
     * (one sentence + one CTA microcopy) so the placeholder doesn't
     * become its own design surface.
     */
    reports: {
        heading: "Reports",
        emptyTitle: "Reports are coming soon",
        emptyDescription:
            "Velocity, burndown, and other project metrics are on their way. We're listening — let us know what you'd like to see first.",
        feedbackCta: "Share feedback",
        feedbackHref:
            "mailto:feedback@pulse.app?subject=Reports%20feedback&body=Tell%20us%20what%20you%27d%20like%20to%20see%20in%20Reports."
    },
    copilotLanding: {
        heading: "Copilot",
        subtitle: "Ask a question or open a brief for the current board.",
        composerPlaceholder: "Ask about your boards, tasks, or members…",
        askTitle: "Ask Copilot",
        askDescription: "Pose a question about your boards, tasks, or members.",
        briefTitle: "Open Board brief",
        briefDescription: "See a one-glance summary of the active board.",
        briefSecondaryAction: "Or open a board brief",
        aiDisabledTitle: "AI is off",
        aiDisabledDescription:
            "Turn on Board Copilot in Settings to use the Copilot tab."
    },
    labels: {
        members: "Members",
        milestones: "Milestones",
        teamMembers: "Team members",
        board: "Board",
        project: "Project",
        projectSections: "Project sections",
        reports: "Reports",
        briefShort: "Brief",
        copilotShort: "Copilot",
        askShort: "Ask",
        noOrganization: "No organization"
    },
    fields: {
        assignees: "Assignees",
        column: "Column",
        coordinator: "Coordinator",
        dependsOn: "Depends on",
        dueDate: "Due date",
        email: "Email",
        epic: "Epic",
        labels: "Labels",
        manager: "Manager",
        milestone: "Milestone",
        notes: "Notes",
        organization: "Organization",
        parentTask: "Parent task",
        password: "Password",
        priority: "Priority",
        projectName: "Project name",
        startDate: "Start date",
        storyPoints: "Story points",
        taskName: "Task name",
        type: "Type",
        username: "Username"
    },
    placeholders: {
        emailExample: "name@example.com",
        searchProjects: "Search this list",
        searchBoard: "Search this board",
        managers: "Managers",
        manager: "Manager",
        coordinators: "Coordinators",
        coordinator: "Coordinator",
        types: "Types",
        type: "Type",
        selectCoordinator: "Select a coordinator",
        selectType: "Select a type",
        selectManager: "Select a manager",
        selectPriority: "Select a priority",
        selectStoryPoints: "Select story points",
        selectAssignees: "Select assignees",
        selectDependencies: "Select prerequisite tasks",
        selectLabels: "Select labels",
        selectMilestone: "Select a milestone",
        selectParentTask: "Select a parent task",
        selectStartDate: "Select a start date",
        selectDueDate: "Select a due date",
        createColumnName: "Create column name",
        whatNeedsToBeDone: "What needs to be done?",
        notesAcceptanceCriteria: "Notes / acceptance criteria",
        chatAsk: "Ask a question… (Shift+Enter for a new line)",
        commandPaletteNav: "Search projects, tasks, columns, members…",
        commandPaletteAi: "Ask Board Copilot…",
        taskPromptExample:
            "e.g. Investigate flaky login on Safari, blocks v2 release",
        describeWork: "Describe the work in your own words"
    },
    options: {
        /*
         * Phase 4.2 — project-list sort options. The legacy
         * `options.sort.*` block (removed in Wave 6 cleanup) used to
         * live alongside this one; it had zero consumers after the
         * project-list migration, so the block was dropped to keep
         * the dictionary honest. The five-mode union here (with
         * `createdAt-desc` + a favorited-first mode) stays in its
         * own namespace so future board / other-list-surface sort
         * changes don't churn this key.
         */
        projectListSort: {
            createdAtDesc: "Newest first",
            createdAtAsc: "Oldest first",
            nameAsc: "Name (A → Z)",
            nameDesc: "Name (Z → A)",
            favoritedFirst: "Favorited first"
        },
        taskTypes: {
            task: "Task",
            bug: "Bug"
        },
        // Per-column "done" semantics shown in the column-create picker.
        // The stored ``category`` is the source of truth for done-ness.
        columnCategories: {
            todo: "To do",
            in_progress: "In progress",
            done: "Done"
        },
        // Task priority enum labels (PRD §3). Keyed by the stored
        // `TaskPriorityLevel` value so the modal Select and the card badge read
        // the same dictionary; `none` is the default and renders no badge.
        priorities: {
            none: "None",
            low: "Low",
            medium: "Medium",
            high: "High",
            urgent: "Urgent"
        }
    },
    counts: {
        projects: {
            one: "{count} project",
            other: "{count} projects"
        },
        results: {
            one: "{count} result",
            other: "{count} results"
        },
        targets: {
            one: "{count} target",
            other: "{count} targets"
        },
        tasksMatchingActiveFilters: {
            one: "{count} task matches the active filters",
            other: "{count} tasks match the active filters"
        },
        subtasksCreated: {
            one: "{count} subtask created.",
            other: "{count} subtasks created."
        },
        subtasksRemoved: {
            one: "{count} subtask removed.",
            other: "{count} subtasks removed."
        },
        subtasksRemoveFailed: {
            one: "Couldn't remove {count} subtask.",
            other: "Couldn't remove {count} subtasks."
        },
        subtasksRemovedPartial:
            "{removed} removed, {failed} could not be removed.",
        createNSubtasks: "Create {count} subtasks"
    },
    chips: {
        search: "Search",
        manager: "Manager",
        coordinator: "Coordinator",
        type: "Type",
        ai: "AI",
        smartMatch: "Smart match",
        /*
         * Phase 4.2 — favorited-only project filter chip. Pairs with
         * the toggle in the project search panel; the chip's value is
         * the static "Yes" since the dimension is boolean and the
         * label ("Favorited") already names the filter.
         */
        favoritedOnly: "Favorited",
        favoritedOnlyOn: "Yes"
    },
    /**
     * Phase 3 A7 — Lens chip row above the board filter rail. The
     * "coming soon" badge is shown on lenses whose data field is not
     * yet on `ITask` (dueDate, aiRisk — Phase 4) so users see the
     * shape of the feature without the predicate silently no-op'ing.
     */
    lenses: {
        today: "Today",
        thisWeek: "This week",
        mine: "Mine",
        highPriority: "High priority",
        urgent: "Urgent",
        atRisk: "At risk",
        todayTooltip: "Tasks due today",
        thisWeekTooltip: "Tasks due in this ISO week (Mon–Sun)",
        mineTooltip: "Tasks where you're the coordinator",
        highPriorityTooltip: "Tasks at high or urgent priority",
        urgentTooltip: "Tasks at urgent priority",
        atRiskTooltip: "Tasks AI-flagged as high or medium risk",
        comingSoonBadge: "Soon"
    },
    confirm: {
        deleteProject: {
            title: "Delete this project?",
            description: "This action cannot be undone.",
            confirmLabel: "Delete project"
        },
        deleteColumn: {
            title: "Delete this column?",
            description: "This action cannot be undone.",
            confirmLabel: "Delete column"
        },
        deleteTask: {
            title: "Delete this task?",
            description: "This action cannot be undone.",
            confirmLabel: "Delete task"
        },
        discardChanges: {
            title: "Discard changes?",
            description: "Your unsaved changes will be lost.",
            confirmLabel: "Discard",
            cancelLabel: "Keep editing"
        }
    },
    feedback: {
        loadFailed: "Couldn't load. Please try again.",
        saveFailed: "Couldn't save. Please try again.",
        operationFailed: "Operation failed",
        retryHint: "Check your connection or retry.",
        noManager: "No manager",
        noDate: "No date",
        renderFailed: "This page couldn't render.",
        renderFailedHint:
            "Try again, or reload the page if the problem persists.",
        reloadPage: "Reload page",
        networkError:
            "Unable to connect. Check your internet connection and try again.",
        optimisticReverted: "Couldn't save — your changes were reverted.",
        projectDeleted: "Project deleted",
        taskDeleted: "Task deleted",
        columnDeleted: "Column deleted",
        likeFailed: "Couldn't update like. Please try again.",
        taskSaved: "Task saved",
        taskRestored: "Task restored",
        taskRestoreFailed: "Couldn't restore the task. Please try again.",
        taskPurged: "Task permanently deleted",
        taskPurgeFailed:
            "Couldn't permanently delete the task. Please try again.",
        taskUnarchived: "Task unarchived",
        taskUnarchiveFailed: "Couldn't unarchive the task. Please try again.",
        welcomeBack: "Welcome back!",
        loginFailedNoToken:
            "Login response was missing a session token. Please try again.",
        loginCouldNotPersistSession:
            "Could not save your session. Turn off private browsing, allow site data for this site, then try again.",
        accountCreated: "Account created. Please log in.",
        couldntDeleteTask: "Couldn't delete {name}.",
        couldntCopy: "Couldn't copy",
        couldntGenerateBrief: "Couldn't generate the brief",
        searchFailed: "Search failed. Try again.",
        searchFailedTitle: "Search failed",
        searching: "Searching",
        searchingTag: "Searching…",
        resultsFiltered: "Results filtered. {rationale}",
        noTasksMatched:
            "No tasks matched your search. Try different words, or clear to see everything.",
        boardEmpty: "This board has no tasks yet.",
        /** ARIA grouping for thumbs feedback on Copilot estimate / readiness. */
        taskAssistTitle:
            "{section}: Rate this Board Copilot task assist suggestion",
        /** ARIA grouping for thumbs feedback on the board brief recommendation. */
        boardBriefTitle:
            "{section}: Rate this Board Copilot brief recommendation"
    },
    /**
     * ICU-style placeholder greeting. Header reads it as
     * `microcopy.greeting.replace("{name}", username)`. Keeping the token
     * in a single string (instead of `${microcopy.actions.hi} ${name}`)
     * lets translators reorder the noun and the verb per locale.
     */
    greeting: "Hi, {name}",
    header: {
        logoLabel: "Pulse home"
    },
    breadcrumb: {
        projects: "Projects",
        reports: "Reports"
    },
    board: {
        title: "Board",
        titleWithName: "{name}",
        swipeHint: "Swipe for more columns",
        enableCopilotOnBoard: "Enable on this board",
        copilotMenuAsk: "Ask Copilot",
        copilotMenuBrief: "Board brief",
        copilotMenuProjectOff: "Project AI off",
        copilotProjectDisabledDescription:
            "Hides Board Copilot on this board and blocks AI requests for this project.",
        /*
         * Phase 4.2 — board density toggle. Comfortable is the legacy
         * spacing rhythm; Compact tightens the card padding ~25–30% so
         * power users can fit more cards in a column without
         * scrolling. The aria-label rides on the AntD Segmented so
         * screen-reader users hear "Board density" before the
         * selected option name.
         */
        densityLabel: "Board density",
        densityComfortable: "Comfortable",
        densityCompact: "Compact",
        /*
         * Phase 4.2 — saved filter presets on the board. Sit in the
         * task-search panel as a small dropdown + save action.
         */
        filtersToggle: "Filters",
        filtersToggleAria: "Search and filter tasks",
        lensesToggle: "Lenses",
        lensesToggleAria: "Board view lenses",
        smartSearchToggle: "Smart search",
        smartSearchToggleAria: "Toggle AI smart search",
        moreActionsAria: "More board actions",
        viewOptionsToggle: "View options",
        viewOptionsToggleAria: "Show board view options",
        presets: {
            saveAction: "Save filter as preset…",
            saveAriaLabel: "Save current filter as preset",
            namePlaceholder: "Preset name",
            saveConfirm: "Save",
            saveCancel: "Cancel",
            loadAriaLabel: "Load saved filter preset",
            loadPlaceholder: "Saved presets",
            deleteAriaLabel: "Delete preset {name}",
            limitReachedBody:
                "You can save up to {limit} presets. Delete one before saving another.",
            saved: "Preset saved",
            applied: "Applied preset {name}",
            staleValueWarning:
                "Some values in this preset no longer exist and were skipped."
        },
        /*
         * Phase 4.6 board minimap (sticky overview strip). Visible
         * label hidden — the minimap is purely visual chrome, the
         * navigation landmark and per-segment buttons carry the
         * accessible names. `inViewStatus` / `offScreenStatus` are
         * suffixed into each segment's aria-label so a screen reader
         * announces "Todo column, 4 tasks, currently in view" /
         * "currently off-screen".
         *
         * `aria` is the landmark name for `<nav>` so screen-reader
         * users can quickly jump to / past the minimap with `D` (NVDA
         * landmark navigation) or `VO+U` rotor (macOS VoiceOver).
         *
         * `segmentAriaOne` / `segmentAriaOther` follow the plural-pair
         * pattern used elsewhere in this file (no ICU formatter is
         * loaded; call sites pick the right key off the count and
         * `.replace()` to interpolate). The codebase deliberately does
         * NOT embed ICU plural syntax in the value because a single-
         * string `{count, plural, one {…} other {…}}` would render
         * literally to screen-reader users.
         */
        minimap: {
            aria: "Board minimap",
            segmentAriaOne: "{name} column, 1 task, currently {status}",
            segmentAriaOther:
                "{name} column, {count} tasks, currently {status}",
            inViewStatus: "in view",
            offScreenStatus: "off-screen"
        }
    },
    projectModal: {
        createDescription:
            "Set a name, organization, and a manager to start tracking work.",
        editDescription: "Update project details and assignment."
    },
    taskModal: {
        removedByOthersTitle: "This task was removed by another change.",
        removedByOthersBody:
            "Your edits are still here. Discard them or save them as a new task to keep them.",
        discardEdits: "Discard edits",
        aiAssistLabel: "AI assist",
        moreDetails: "More details",
        moreActionsAria: "More task actions",
        blocksLabel: "Blocks"
    },
    taskCard: {
        /** Visible chip text on an overdue card (paired with an icon, not colour-only). */
        overdue: "Overdue",
        /** Visible chip text on a blocked card (paired with an icon, not colour-only). */
        blocked: "Blocked",
        /** Visible chip text on a completed card (paired with an icon, not colour-only). */
        completed: "Completed"
    },
    taskDetailPanel: {
        confirmDiscardTitle: "Discard unsaved changes?",
        confirmDiscardBody: "Your edits to this task will be lost.",
        confirmDiscardOk: "Discard",
        confirmDiscardCancel: "Keep editing",
        siblingNextLabel: "Next task",
        siblingPrevLabel: "Previous task",
        siblingPositionLabel: "Task {position} of {total}",
        ariaLabel: "Task details",
        siblingNavAriaLabel: "Sibling task navigation"
    },
    copilotDock: {
        title: "Copilot",
        ariaLabel: "Copilot dock",
        closeLabel: "Close Copilot",
        tabChat: "Chat",
        tabBrief: "Brief",
        tabListLabel: "Copilot surfaces",
        inboxTab: {
            title: "Inbox",
            emptyTitle: "You're all caught up",
            emptyDescription:
                "Copilot will surface triage nudges here as it spots issues on your board.",
            seeAll: "See all in Inbox",
            // Plural pair (one/other) follows the `counts.*` pattern in
            // this file. Call sites pick the right key off the count
            // and `.replace("{count}", String(count))` to interpolate.
            // We intentionally do NOT embed ICU plural syntax in the
            // value because this codebase has no ICU formatter; a
            // single-string `{count, plural, one {nudge} other {nudges}}`
            // would render literally to screen-reader users.
            unreadBadgeAriaLabelOne: "{count} unread Copilot nudge",
            unreadBadgeAriaLabelOther: "{count} unread Copilot nudges",
            sectionLabel: "Triage nudges",
            actionLabel: "Open task",
            dismissLabel: "Dismiss"
        }
    },
    activityFeed: {
        // Bell-icon aria-label. One/other plural pair — the consumer
        // picks the right key off the unread count and interpolates
        // `{count}`. We intentionally do NOT embed ICU plural syntax
        // because this codebase has no ICU formatter; a literal
        // `{count, plural, one {…} other {…}}` would read out to
        // screen-reader users verbatim.
        bellAriaLabelZero: "Activity feed, no new notifications",
        bellAriaLabelOne: "Activity feed, {count} unread notification",
        bellAriaLabelOther: "Activity feed, {count} unread notifications",
        drawerTitle: "Activity",
        drawerCloseLabel: "Close activity drawer",
        markAllRead: "Mark all as read",
        markAllReadAriaLabel: "Mark all activity as read",
        empty: "All quiet. New activity will show up here.",
        groupToday: "Today",
        groupYesterday: "Yesterday",
        groupEarlier: "Earlier",
        // Date-relative ticker reused from the AI-activity log shape so
        // the two surfaces speak the same temporal language; this lives
        // under `activityFeed.relative*` so future tuning is local.
        relativeJustNow: "just now",
        relativeOneMinute: "1 min ago",
        relativeMinutes: "{count} min ago",
        relativeOneHour: "1 hour ago",
        relativeHours: "{count} hours ago",
        relativeOneDay: "1 day ago",
        relativeDays: "{count} days ago",
        undo: "Undo",
        undoAriaLabel: "Undo: {summary}",
        undoFailedToast: "Couldn't undo: {error}",
        kindLabels: {
            task: "Task",
            column: "Column",
            project: "Project",
            ai: "AI"
        },
        descriptions: {
            taskCreated: "Created task “{name}”",
            taskUpdated: "Updated task “{name}”",
            taskDeleted: "Deleted task “{name}”",
            taskRenamed: "Renamed task to “{name}”",
            taskMoved: "Moved “{taskName}” from {fromColumn} to {toColumn}",
            columnCreated: "Created column “{name}”",
            columnUpdated: "Updated column “{name}”",
            columnDeleted: "Deleted column “{name}”",
            columnRenamed: "Renamed column to “{name}”",
            projectCreated: "Created project “{name}”",
            projectUpdated: "Updated project “{name}”",
            projectDeleted: "Deleted project “{name}”"
        }
    },
    /*
     * Trash drawer (work-management-depth §5.4/§5.6). A read-only,
     * board-scoped list of soft-deleted tasks. Each row offers Restore
     * (un-delete) and a guarded "Delete permanently" (purge). The
     * `restoreAriaLabel` / `deletePermanentlyAriaLabel` carry the task
     * name so screen-reader users can tell the per-row buttons apart;
     * call sites interpolate `{name}` via `String#replace`.
     */
    trashDrawer: {
        triggerLabel: "Trash",
        triggerAriaLabel: "Open trash",
        drawerTitle: "Trash",
        empty: {
            title: "Trash is empty",
            description:
                "Deleted tasks land here. Restore one to put it back on the board, or delete it permanently."
        },
        restore: "Restore",
        restoreAriaLabel: "Restore task “{name}”",
        deletePermanently: "Delete permanently",
        deletePermanentlyAriaLabel: "Permanently delete task “{name}”",
        confirm: {
            title: "Delete this task permanently?",
            description: "This can't be undone.",
            confirmLabel: "Delete permanently"
        }
    },
    archiveDrawer: {
        triggerLabel: "Archive",
        triggerAriaLabel: "Open archive",
        drawerTitle: "Archive",
        empty: {
            title: "Archive is empty",
            description:
                "Archived tasks land here. Unarchive one to put it back on the board, or delete it permanently."
        },
        unarchive: "Unarchive",
        unarchiveAriaLabel: "Unarchive task “{name}”",
        deletePermanently: "Delete permanently",
        deletePermanentlyAriaLabel: "Permanently delete task “{name}”",
        confirm: {
            title: "Delete this task permanently?",
            description: "This can't be undone.",
            confirmLabel: "Delete permanently"
        }
    },
    /*
     * Notification bell (backend Notifications feature). Distinct from the
     * session-only `activityFeed` above: these strings drive the header
     * bell + drawer that surface server-persisted notifications (mentions,
     * etc.) the user can mark read. The bell aria-label follows the same
     * one/other plural pattern as `activityFeed` — the consumer picks the
     * key off the unread count and interpolates `{count}` (no ICU plural
     * syntax because the codebase has no formatter).
     */
    unifiedNotifications: {
        bellAriaLabelZero: "Notifications, none unread",
        bellAriaLabelOne: "Notifications, {count} unread",
        bellAriaLabelOther: "Notifications, {count} unread",
        drawerTitle: "Notifications",
        tabActivity: "Activity",
        tabAlerts: "Alerts"
    },
    notifications: {
        bellAriaLabelZero: "Notifications, none unread",
        bellAriaLabelOne: "Notifications, {count} unread",
        bellAriaLabelOther: "Notifications, {count} unread",
        drawerTitle: "Notifications",
        drawerCloseLabel: "Close notifications",
        markAllRead: "Mark all as read",
        markAllReadAriaLabel: "Mark all notifications as read",
        markReadAriaLabel: "Mark as read: {summary}",
        empty: "You're all caught up. New notifications will show up here.",
        // Relative-time ticker (same shape as `activityFeed.relative*`) so
        // the bell speaks the app's shared temporal language.
        relativeJustNow: "just now",
        relativeOneMinute: "1 min ago",
        relativeMinutes: "{count} min ago",
        relativeOneHour: "1 hour ago",
        relativeHours: "{count} hours ago",
        relativeOneDay: "1 day ago",
        relativeDays: "{count} days ago"
    },
    /*
     * Task comments + @mentions (M4 — backend Collaboration feature).
     * The thread mounts inside the task modal: a list of comments plus a
     * composer with a member-mention picker. A mention produces a
     * `notifications` row for each valid mentioned member, which is why
     * this surface is the producer the notification bell consumes. Button
     * verbs reuse `actions.*` (edit / delete / save / cancel); only the
     * comments-specific labels, aria-names, and error copy live here.
     */
    comments: {
        heading: "Comments",
        empty: "No comments yet. Start the conversation.",
        placeholder: "Write a comment…",
        mentionLabel: "Mention",
        mentionPlaceholder: "Mention teammates",
        post: "Post comment",
        posting: "Posting…",
        deleteConfirmTitle: "Delete this comment?",
        listAriaLabel: "Comments",
        editAriaLabel: "Edit comment",
        deleteAriaLabel: "Delete comment",
        loadError: "Couldn't load comments. Please try again.",
        postError: "Couldn't post your comment. Please try again.",
        editError: "Couldn't save your changes. Please try again.",
        deleteError: "Couldn't delete the comment. Please try again.",
        you: "You",
        unknownAuthor: "Unknown user"
    },
    /*
     * Project member management (M4 — backend Collaboration feature).
     * The Members surface lists the project roster with each member's
     * role and lets a project owner add members from the global user
     * directory, change roles, and remove members. The manager row is
     * immutable server-side (the project's `managerId` cannot be
     * demoted or removed), so the UI disables those controls and shows
     * a badge + hint. Read-only viewers see the roster as tags with no
     * controls. Button verbs that already exist (`actions.cancel`) are
     * reused; only the members-specific labels, aria-names, role names,
     * and error copy live here.
     */
    members: {
        heading: "Members",
        addHeading: "Add a member",
        addUserPlaceholder: "Select a user",
        addRolePlaceholder: "Select a role",
        addButton: "Add member",
        adding: "Adding…",
        remove: "Remove",
        removeConfirmTitle: "Remove {name} from this project?",
        changeRoleAriaLabel: "Change role for {name}",
        removeAriaLabel: "Remove {name}",
        managerBadge: "Manager",
        managerImmutableHint:
            "The project manager's role can't be changed or removed.",
        readOnlyHint: "Only a project owner can manage members.",
        empty: "No members yet.",
        loadError: "Couldn't load members. Please try again.",
        addError: "Couldn't add the member. Please try again.",
        updateError: "Couldn't update the role. Please try again.",
        removeError: "Couldn't remove the member. Please try again.",
        noAddableUsers: "Everyone in your directory is already a member.",
        listAriaLabel: "Project members",
        roles: {
            owner: "Owner",
            editor: "Editor",
            viewer: "Viewer",
            guest: "Guest"
        }
    },
    /**
     * FE-MS-1 project milestones surface. Mirrors the `members.*` shape:
     * a manager title, the add-form labels / placeholders, the lifecycle
     * state options, the delete confirm, the empty / load-error copy, and
     * the create / update / delete / failure feedback toasts.
     */
    milestones: {
        heading: "Milestones",
        addHeading: "Add a milestone",
        addNamePlaceholder: "Milestone name",
        addDescriptionPlaceholder: "Description (optional)",
        startDatePlaceholder: "Start date",
        dueDatePlaceholder: "Due date",
        statePlaceholder: "State",
        addButton: "Add milestone",
        adding: "Adding…",
        save: "Save",
        saving: "Saving…",
        cancel: "Cancel",
        edit: "Edit",
        editAriaLabel: "Edit {name}",
        delete: "Delete",
        deleteConfirmTitle: "Delete {name}?",
        deleteAriaLabel: "Delete {name}",
        empty: "No milestones yet.",
        loadError: "Couldn't load milestones. Please try again.",
        listAriaLabel: "Project milestones",
        dateRange: "{start} → {due}",
        states: {
            open: "Open",
            closed: "Closed"
        },
        created: "Milestone created.",
        updated: "Milestone updated.",
        deleted: "Milestone deleted.",
        createError: "Couldn't create the milestone. Please try again.",
        updateError: "Couldn't update the milestone. Please try again.",
        deleteError: "Couldn't delete the milestone. Please try again."
    },
    aiActivityLog: {
        pillLabel: "{count} AI change this session",
        pillLabelPlural: "{count} AI changes this session",
        pillAriaExpanded: "Hide AI activity log",
        pillAriaCollapsed: "Show AI activity log",
        listTitle: "AI activity this session",
        revert: "Revert",
        revertAriaLabel: "Revert: {description}",
        revertUnavailable:
            "Revert isn't available for this entry after reload.",
        clearAll: "Clear all",
        clearConfirmTitle: "Clear AI activity log?",
        clearConfirmBody:
            "Removes every entry in this session. Already-applied changes stay applied.",
        clearConfirmOk: "Clear",
        clearConfirmCancel: "Keep",
        emptyState: "Nothing yet — accept an AI suggestion to see it here.",
        undoFailedToast: "Couldn't undo: {error}",
        relativeJustNow: "just now",
        relativeOneMinute: "1 min ago",
        relativeMinutes: "{count} min ago",
        relativeOneHour: "1 hour ago",
        relativeHours: "{count} hours ago",
        relativeOneDay: "1 day ago",
        relativeDays: "{count} days ago",
        surfaceLabels: {
            "task-assist": "Task assist",
            "task-draft": "Task draft",
            "mutation-proposal": "Mutation proposal"
        },
        descriptions: {
            taskAssistPointsApplied:
                "Applied {points} story points to “{taskName}”",
            taskAssistFieldApplied:
                "Applied AI suggestion to “{taskName}” {field}",
            taskDraftCreated: "Created task “{taskName}” from AI draft",
            mutationProposalApplied: "Applied mutation: {description}"
        }
    },
    projectsPage: {
        title: "Boards",
        subtitle:
            "Browse the boards your team is shipping. Filter, search, or create a new project to start tracking work.",
        totalProjects: "Total projects",
        organizations: "Organizations",
        teamMembers: "Team members",
        loadingStats: "Loading project stats",
        statsAnnouncement:
            "{total} projects across {organizations} organizations, {members} team members.",
        filtersToggleAria: "Filter and sort projects"
    },
    /**
     * Page-name microcopy fed to `useTitle`. The hook composes
     * `${page} · Pulse` so every routable surface advertises the brand
     * in the browser tab. Auth and project-list surfaces consume these
     * keys; board / project-detail pages keep their dynamic project
     * name since they're already context-specific.
     */
    pageTitle: {
        login: "Log in",
        register: "Sign up",
        forgotPassword: "Reset your password",
        terms: "Terms of Service",
        projects: "Boards",
        inbox: "Inbox",
        copilot: "Copilot",
        settings: "Settings",
        share: "Share to Pulse",
        /*
         * Phase 4.7: project reports landing. The template gets the
         * project name interpolated in at the page level — see
         * `pages/reports.tsx`. The bare "Reports" form is the fallback
         * before the project query resolves.
         */
        reports: "Reports",
        reportsWithProject: "Reports · {project}",
        /*
         * M4 project members surface. Mirrors the reports title pattern:
         * the project name is interpolated at the page level (see
         * `pages/members.tsx`); the bare "Members" form is the fallback
         * before the project query resolves.
         */
        members: "Members",
        membersWithProject: "Members · {project}",
        /*
         * FE-MS-1 project milestones surface. Same pattern as members:
         * the project name is interpolated at the page level (see
         * `pages/milestones.tsx`); the bare "Milestones" form is the
         * fallback before the project query resolves.
         */
        milestones: "Milestones",
        milestonesWithProject: "Milestones · {project}"
    },
    empty: {
        projects: {
            title: "No projects yet",
            description:
                "Create your first project to start tracking work, owners, and progress."
        },
        board: {
            title: "Add your first column",
            description:
                "Boards organize tasks into columns. Try Backlog, In progress, Done.",
            cta: "Create your first column"
        },
        members: {
            title: "No team members",
            description: "Invite teammates to collaborate on this workspace."
        },
        chat: {
            title: "Ask Board Copilot",
            description:
                "Try: 'What's at risk?' or 'Who has the most open tasks?' — answers come from your board data."
        },
        filteredColumn: {
            title: "No tasks match the current filters",
            cta: "Reset filters"
        },
        savedPresets: {
            empty: "No saved presets yet."
        },
        commandPalette: {
            loading: "Loading…",
            empty: "No matches."
        },
        notFound: {
            title: "Page not found",
            description:
                "We couldn't find the page you're looking for. It may have moved, or the link might be out of date.",
            cta: "Back to projects"
        }
    },
    /**
     * Board Copilot v3 microcopy (PRD §9.6 X-R13). The `ai` namespace
     * collects every user-visible AI string so a future translator (or a
     * neutral-tone audit) only needs to look at one block. Keep strings
     * tool-like — never "I think" or "I understand" (PRD §6.2).
     */
    ai: {
        draftSuggestions: [
            "Draft a bug fix task",
            "Plan a new feature",
            "Create a research spike"
        ] as readonly string[],
        chatSuggestions: [
            "What's at risk on this board?",
            "Who has the most open tasks?",
            "Summarize this board"
        ] as readonly string[],
        /*
         * Contextual follow-up chips rendered after every assistant
         * turn. The chat drawer chooses 2-3 from this group based on a
         * deterministic keyword scan of `messages[lastUserIndex]`:
         *   - mentions a due date / deadline → `riskFromDue`
         *   - mentions a board member by username → `workOnPerson`
         *   - otherwise the generic trio in `defaults`
         */
        followUpChips: {
            riskFromDue: "Show what's at risk on this board",
            workOnPerson: "What is {name} working on?",
            defaults: [
                "Summarize this board",
                "What's blocked?",
                "What changed today?"
            ] as readonly string[]
        },
        privacyTitle: "What Board Copilot sees",
        privacyDisclosure:
            "Board Copilot uses board and project names, columns, task names, types, story points, epics, notes when present, and member usernames, emails, or user IDs where needed.",
        privacyDataScope: [
            "Board and project names, plus column titles",
            "Task names, types, story points, epics, notes when present, and column placement",
            "Member usernames, emails, and user IDs where needed"
        ] as readonly string[],
        privacyExclusions:
            "Attachments are not included in Board Copilot requests.",
        localProcessingDisclosure:
            "This build uses local deterministic Board Copilot rules. No external AI service processes these requests.",
        remoteProcessingDisclosure:
            "Requests are processed by the configured AI service. Your sign-in token is forwarded so the proxy can authorize your account.",
        remoteProcessingDisclosureWithOrigin:
            "Requests are processed by the configured AI service at {origin}. Your sign-in token is forwarded so the proxy can authorize your account.",
        processingModeLocalLabel: "Local engine",
        processingModeRemoteLabel: "Remote AI service",
        engineCapabilityLocal:
            "Board Copilot in this build runs deterministic project rules locally — no external language model is configured. Suggestions reflect the rules, not a language model.",
        engineCapabilityRemote:
            "Board Copilot is connected to a configured AI service. Outputs may include generated language; review before applying.",
        privacyLink: "What is shared?",
        privacyAcknowledge: "Got it",
        privacySuppress: "Don't remind me",
        streaming: "Reading your board data…",
        stopped: "Stopped",
        retryLabel: "Try again",
        regenerateLabel: "Regenerate",
        undoLabel: "Undo",
        copiedConfirm: "Copied to clipboard",
        feedbackThanks: "Thanks for your feedback",
        feedbackImpactNotice:
            "Feedback is saved for product review — it does not change this answer or train a model.",
        feedbackThumbsDownTooltip:
            "Not helpful? Tell us why. Categories are saved for product review only — your message text is not sent.",
        chatBusyError: "Board Copilot is busy. Try again in a moment.",
        errorBudgetHeading: "Out of AI credits",
        errorBudgetBody:
            "This project has hit its AI budget for the period. Contact your admin to raise the cap.",
        errorForbiddenHeading: "Permission denied",
        errorForbiddenBody:
            "You don't have access to this AI feature for this project.",
        errorNotFoundHeading: "Agent unavailable",
        errorNotFoundBody:
            "This AI feature isn't deployed on the connected server.",
        errorServerHeading: "AI service is having trouble",
        errorServerBody: "Please retry in a moment.",
        errorDefaultHeading: "Board Copilot hit an error",
        errorDefaultBody:
            "Try again, or reload the page if the problem persists.",
        watchdogTimeout: "Board Copilot took too long. Try again.",
        unexpectedResponse: "Got an unexpected response from Board Copilot.",
        toolRoundExhausted:
            "Could not finish the answer (too many steps). Try a narrower question.",
        suggestedStoryPoints: "Suggested story points",
        estimateTaskNameHint: "Type a task name above to get an estimate.",
        estimateConfidenceTooltip: "Based on similar tasks on this board.",
        estimatingPoints: "Estimating story points",
        suggestedPointsAria: "Suggested story points: {points}",
        applyPointsAria: "Apply suggested story points",
        storyPointsSet: "Story points set to {points}.",
        readinessFieldUpdated: "Updated {field}.",
        similarTasks: "Similar tasks:",
        readinessCheck: "Readiness check",
        runningReadiness: "Running readiness check",
        readinessReady: "Looks ready to work on.",
        suggestionStatusLoading: "Updating suggestions.",
        suggestionStatusReady: "Suggestion ready.",
        suggestionStatusError: "Couldn't load suggestions.",
        briefStatusLoading: "Generating brief.",
        briefStatusReady: "Brief ready.",
        briefStatusError: "Couldn't load brief.",
        dismissNudge: "Dismiss",
        agentDegraded: "AI backend is slow (degraded)",
        agentOffline: "AI backend is offline",
        completionAnnouncementOne: "{label} responded with {count} word.",
        completionAnnouncementOther: "{label} responded with {count} words.",
        citationSourceTask: "Task",
        citationSourceColumn: "Column",
        citationSourceMember: "Member",
        citationSourceProject: "Project",
        citationSourceUser: "User",
        feedbackPromptDownTitle: "What went wrong?",
        feedbackPromptDownHelper:
            "Pick at least one — it helps us prioritize fixes without sending your message text.",
        feedbackCategories: {
            incorrect: "Incorrect or made-up information",
            missingSource: "Missing or wrong source",
            outdated: "Used outdated board data",
            notActionable: "Not actionable",
            unsafe: "Unsafe or risky suggestion",
            privacy: "Privacy concern",
            other: "Something else"
        },
        feedbackOptionalNote: "Add an optional note (no message text is sent)",
        feedbackSubmit: "Send feedback",
        feedbackSkip: "Skip",
        regeneratedBadge: "Regenerated response",
        regeneratedTooltip:
            "Board Copilot generated a fresh answer to the same question. The earlier response is still above for comparison.",
        thinkingDefault: "Reading your board data…",
        confidenceBands: {
            high: "High",
            moderate: "Moderate",
            low: "Low"
        },
        suggestedByCopilot: "Suggested by Copilot",
        appliedSuggestion: "Suggested by Copilot",
        appliedSuggestionShort: "AI",
        suggestionPopover:
            "Board Copilot filled this in. Edit it, or revert to the previous value.",
        revertToPrevious: "Revert to previous",
        showAlternatives: "Show alternatives",
        showRationale: "Why this?",
        whyLabel: "Why?",
        whyPopoverTitle: "Why Copilot suggested this",
        applyAnyway: "Apply anyway",
        emptyChatLead:
            "Ask about this board, tasks, or your projects. Answers use read-only data from the app.",
        emptyBriefLead:
            "Not enough history for trends. The brief gets smarter as the board grows.",
        emptyInbox:
            "No nudges right now. Board Copilot checks for issues every 15 minutes.",
        emptyHistory:
            "No AI actions yet. Changes made with Board Copilot will appear here.",
        rateLimit:
            "Board Copilot is at capacity. Please try again in {seconds} seconds.",
        projectDisabled:
            "Board Copilot is turned off for this project. An admin can enable it in Settings.",
        chatErrorRecovery:
            "No answer was found. Try rephrasing, or check the listed sources.",
        chatNoSourcesCaveat:
            "No board records were opened for this answer — verify before acting on it.",
        copilotLabel: "Board Copilot",
        askCopilot: "Ask Board Copilot",
        findRelatedTasks: "Find related tasks",
        findRelatedProjects: "Find related projects",
        findRelatedTasksAria:
            "Find related tasks with AI and filter the task list",
        findRelatedProjectsAria:
            "Find related projects with AI and filter the project list",
        findRelatedTasksPlaceholder: "Describe tasks to find…",
        findRelatedProjectsPlaceholder: "Describe projects to find…",
        findRelatedTasksHelper:
            "Matches by task name, type, epic, and notes. Filters this list — does not open chat.",
        findRelatedProjectsHelper:
            "Matches by project name, organization, and manager. Filters this list — does not open chat.",
        searchMatchStrength: {
            strong: "Strong match",
            moderate: "Partial match",
            weak: "Weak match"
        },
        searchMatchStrengthAria:
            "Match strength {strength} for the AI semantic search",
        searchSynonymExpanded:
            "Expanded {original} to include common synonyms ({expansions}).",
        citationAriaLabel: "Citation {index}: {source} {id}",
        citationFlagAction: "Report wrong source",
        citationFlagConfirm: "Thanks — flagged for review",
        remoteConsentTitle: "Heads up: this build sends data to a remote AI",
        remoteConsentBody:
            "Board Copilot is connected to {origin}. Your sign-in token, board data, and any task you open are sent there for processing. Outputs may include generated language — review before applying.",
        remoteConsentBodyGeneric:
            "Board Copilot is connected to a configured AI service. Your sign-in token, board data, and any task you open are sent there for processing. Outputs may include generated language — review before applying.",
        remoteConsentAccept: "I understand",
        remoteConsentLearnMore: "What is shared?",
        newConversation: "New conversation",
        newConversationConfirm:
            "Starting a new conversation will clear all current history. Continue?",
        startNew: "Start new",
        stopResponse: "Stop response",
        chatResponding: "Board Copilot is responding.",
        healthOffline:
            "Board Copilot is currently unavailable. Try again later.",
        healthDegraded:
            "Board Copilot is experiencing delays. Responses may be slow or unavailable.",
        healthIssueTemplate: "Board Copilot is not ready: {detail}",
        healthWarningTemplate: "Board Copilot is degraded: {detail}",
        healthProviderUnreachableTemplate:
            "Board Copilot cannot reach {provider}: {detail}",
        healthProviderGeneric: "the AI provider",
        healthStubMode:
            "Board Copilot is connected, but the server is using the stub provider instead of a real LLM.",
        healthRealProviderNotReady:
            "Board Copilot is connected, but no real LLM provider is ready.",
        conversationTooLong:
            "Conversation too long. Start a new session or try a shorter message.",
        conversationLongWarning:
            "This conversation is getting long. Consider starting a new session to maintain response quality.",
        sessionNotSaved: "Sessions are not saved — history clears on reload.",
        showFullResponse: "Show full response",
        stillThinking: "Still thinking…",
        jumpToLatest: "Jump to latest",
        moreSources: "+{count} more",
        copiedShort: "Copied",
        copyMessage: "Copy message",
        copyMessageCopied: "Copied to clipboard",
        toolDetailsToggle: "Show details",
        toolDetailsHide: "Hide details",
        characterCountTemplate: "{count}/{max}",
        characterCountAtLimit: "{count}/{max} — character limit reached.",
        toolEmptyResult: "empty result",
        toolVerbs: {
            checkedProjects: "Checked projects",
            checkedTeamMembers: "Checked team members",
            checkedBoardColumns: "Checked board columns",
            checkedTasks: "Checked tasks",
            openedProject: "Opened project",
            openedTask: "Opened task",
            lookedUpEvidence: "Looked up evidence"
        },
        requestedDataCouldNotBeLoaded:
            "The requested data could not be loaded.",
        noProjectsFound: "No projects found.",
        noTeamMembersFound: "No team members.",
        noColumnsFound: "No columns on this board.",
        noTasksFound: "No tasks match.",
        checkedProjectsSummaryOne: "Checked {count} project.",
        checkedProjectsSummaryOther: "Checked {count} projects.",
        checkedMembersSummaryOne: "Checked {count} member.",
        checkedMembersSummaryOther: "Checked {count} members.",
        checkedColumnsSummaryOne: "Checked {count} column.",
        checkedColumnsSummaryOther: "Checked {count} columns.",
        checkedTasksSummaryOne: "Checked {count} task.",
        checkedTasksSummaryOther: "Checked {count} tasks.",
        openedProjectSummary:
            "Opened project **{name}** (org: {organization}).",
        openedTaskSummary: "Opened task **{name}**.",
        taskMetaLine: "Type: {type} · Points: {points} · Epic: {epic}",
        unownedSection: "Unowned: {names}",
        workloadSection: "Workload: {entries}",
        generateBoardBriefPrompt: "Generate the brief for this board.",
        runBoardTriagePrompt: "Run a triage check on the current board.",
        storyPointsSetTo: "Story points set to {value}.",
        readinessUpdated: "Updated {field}.",
        characterCounterMax: 4000,
        breakdownAxes: {
            by_phase: {
                label: "By phase",
                tooltip: "Frontend, backend, testing"
            },
            by_surface: {
                label: "By surface",
                tooltip: "UI, API, data, infra"
            },
            by_risk: {
                label: "By risk",
                tooltip: "High risk first, low risk last"
            },
            freeform: {
                label: "Let Copilot decide",
                tooltip: "Agent picks the best split"
            }
        },
        welcomeBannerTitle: "Board Copilot is ready",
        welcomeBannerBody:
            "Draft tasks, estimate work, summarize the board, and answer questions — all from your board data.",
        welcomeBannerCta: "Try: Summarize this board",
        /**
         * The actual prompt sent to chat when the welcome banner CTA
         * fires. Matches the user-facing wording of the suggestion in
         * `chatSuggestions` so a user who picks the CTA gets the same
         * experience as one who taps the chip in chat.
         */
        welcomeBannerCtaPrompt: "Summarize this board",
        welcomeBannerDismiss: "Dismiss",
        whyThisResult: "Why this result?",
        didYouMean: "Did you mean:",
        draftSamplePlanFeature: "Plan a feature for {project}",
        draftSampleFallbackProject: "this project",
        reviewAndEdit: "review and edit before creating",
        pickSubtasks: "pick the subtasks you want to create",
        breakdownAxisInfo: "Axis: {label}",
        bulkProgressFormat: "{current} of {total}",
        autonomyLabel: "Copilot mode",
        autonomyLevelSuggest: "Suggest",
        autonomyLevelPlan: "Plan",
        autonomyLevelAuto: "Auto",
        autonomySelectorAriaLabel: "Select Copilot autonomy mode",
        autonomyAutoDisabledTooltip:
            "Auto requires an agent that supports preapproved tools. Available in v3.",
        /**
         * Column-readiness pill (Phase 4 W3 — docs/design/_review-2026-05
         * /04-ai-copilot.md §Ambition 5). The pill summarises the
         * deterministic readiness engine's verdict for every task in a
         * column; the popover lists the individual blocker tasks so the
         * user can jump in and groom them.
         */
        columnReadiness: {
            readyLabel: "Ready to ship",
            groomingLabel: "Needs grooming",
            popoverTitleReady: "Ready to ship · {ready}/{total}",
            popoverTitleGrooming: "Needs grooming · {ready}/{total}",
            popoverEmptyReady: "Every task in this column passed the check.",
            popoverBlockerListLabel: "Tasks still needing work"
        },
        /**
         * Inline ghost-text suggestions in the task description field
         * (Phase 4 W3 — docs/design/_review-2026-05/04-ai-copilot.md
         * §Ambition 2). The wrapper renders the local-engine completion
         * as faded text after the caret; Tab accepts, Esc dismisses.
         */
        ghostText: {
            acceptHint: "Press Tab to accept · Esc to dismiss",
            dismissAriaLabel: "Dismiss ghost-text suggestion",
            srOnlySuggestionPrefix: "Copilot suggests:",
            srOnlySuggestionAccepted: "Suggestion accepted.",
            srOnlySuggestionDismissed: "Suggestion dismissed."
        }
    },
    auth: {
        loginTitle: "Log in to your account",
        loginSubtitle: "Enter your email and password to continue.",
        forgotPassword: "Forgot password?",
        forgotPasswordPlaceholderTitle: "Reset your password",
        forgotPasswordPlaceholderBody:
            "Password reset is coming soon. Please contact your workspace admin if you need immediate access.",
        registerTitle: "Sign up for an account",
        registerSubtitle: "Create your account to start tracking work.",
        switchToRegister: "Don't have an account?",
        switchToLogin: "Already have an account?",
        backToLogin: "Back to log in",
        errorSummaryTitle: "There is a problem",
        errorSummaryIntro: "Correct the following and try again.",
        errorSummaryRegionAriaLabel: "Form errors",
        heroBadge: "New: Board Copilot",
        heroTitle: "Ship work with calm focus.",
        heroSubtitle:
            "A focused project board that turns work into momentum. Drag, drop, draft with AI, and keep your team in flow.",
        heroFeatureDraft: "Draft tasks and standup briefs with AI.",
        heroFeatureDrag: "Drag-and-drop columns and cards.",
        heroFeatureColors: "Light, dark, and system color modes.",
        heroFinePrint:
            "Built for teams that ship. Free to try, no credit card.",
        passwordStrength: {
            meterAriaLabel: "Password strength",
            tooShort: "Too short — use at least 8 characters.",
            weak: "Weak — mix upper-case, lower-case, numbers, or symbols.",
            fair: "Fair — add length or another character type for a stronger password.",
            strong: "Strong password."
        },
        termsLink: "Terms of Service",
        termsLoginPrefix: "By signing in, you agree to our",
        termsLoginSuffix: ".",
        termsRegisterPrefix: "By signing up, you agree to our",
        termsRegisterSuffix: ".",
        termsPageTitle: "Terms of Service",
        termsPageBody:
            "This deployment does not yet host standalone legal text. Ask your administrator or Pulse legal contact for the terms and acceptable-use policy that apply to your workspace."
    },
    commandPalette: {
        title: "Command palette",
        kindLabels: {
            project: "Projects",
            task: "Tasks",
            column: "Columns",
            member: "Members"
        },
        kindTags: {
            project: "Project",
            task: "Task",
            column: "Column",
            member: "Member"
        },
        sublabelColumn: "Column",
        navigateInstructions:
            "Search and navigate. Start the query with “/” to switch to Board Copilot.",
        copilotPromptHint: "Type your question, then press Enter.",
        noResultsCopilotCta: "Try asking Board Copilot →",
        sampleAi: [
            "What's at risk on this board?",
            "Summarize this board",
            "Who has the most open work?"
        ] as readonly string[]
    },
    brief: {
        title: "Board Copilot brief",
        headline: "{total} tasks on the board, {inProgress} in progress.",
        recommendedNextStep: "Recommended next step",
        summaryTitle: "At a glance",
        summaryTotalTasks: "Total tasks",
        summaryColumns: "Columns",
        summaryUnowned: "Unowned",
        summaryContributors: "Contributors",
        countsPerColumn: "Counts per column",
        countsBarAria: "{column}: {count} tasks",
        largestUnstarted: "Largest unstarted",
        unownedTasks: "Unowned tasks",
        workload: "Workload",
        noUnstarted: "No unstarted tasks. Nice.",
        allOwned: "All tasks have an owner.",
        noActivePerMember: "No active tasks per member.",
        boardEmpty: "Board is empty — start by creating a task.",
        unstartedWaiting: "{count} unstarted tasks waiting for pickup.",
        overloaded:
            "{name} is carrying {count} open tasks — consider reassigning.",
        unownedHeadline: "{count} tasks have no owner.",
        column: "Column",
        tasks: "Tasks",
        basisLabel: "Basis: {text}",
        basisItalic: "_Basis: {text}_",
        openCount: "{count} open",
        ptsCount: "{count} pts",
        generated: "Generated {time}",
        relativeJustNow: "just now",
        relativeOneMinute: "1 minute ago",
        relativeMinutes: "{count} minutes ago",
        relativeOneHour: "1 hour ago",
        relativeHours: "{count} hours ago",
        relativeOneDay: "1 day ago",
        relativeDays: "{count} days ago",
        balancedRecommendation:
            "Board looks balanced. Pick the next item from the top of Backlog.",
        noIssuesBasis:
            "No imbalance, oversized work, or unowned tasks detected.",
        assignUnownedRecommendation:
            "Assign coordinators to {count} unowned tasks before starting new work.",
        unownedBasis:
            "Counted {count} tasks with no coordinator on this board.",
        largeTaskRecommendation:
            '"{name}" is large ({points} pts). Consider breaking it down.',
        largeTaskBasis: "Largest unstarted task is {points} story points.",
        rebalanceRecommendation:
            "{top} is carrying {points} pts; consider rebalancing toward {bottom}.",
        rebalanceBasis:
            "{top} holds {topPoints} open pts vs {bottomPoints} for {bottom} — at least a 2:1 imbalance.",
        strengthLabels: {
            strong: "Strong signal",
            moderate: "Moderate signal",
            low: "Low signal — review",
            none: "No action needed"
        },
        strengthTooltips: {
            strong: "Multiple board signals support this recommendation. Acting on it should be safe.",
            moderate:
                "One or two board signals back this recommendation. Skim the basis before acting.",
            low: "The signal is weak. Review the basis carefully before acting on this.",
            none: "No imbalance detected. Recommendation is informational only."
        },
        markdownCountsHeading: "Counts per column",
        markdownLargestHeading: "Largest unstarted",
        markdownUnownedHeading: "Unowned",
        markdownWorkloadHeading: "Workload",
        markdownStoryPoints: "{count} pts",
        markdownWorkloadEntry: "{count} open / {points} pts"
    },
    about: {
        title: "About Board Copilot",
        canHelpTitle: "What Board Copilot can help with",
        canHelpItems: [
            "Search and filter tasks",
            "Summarize board status",
            "Draft new tasks",
            "Estimate effort for tasks",
            "Answer questions about your project"
        ] as readonly string[],
        limitationsTitle: "What it cannot do",
        limitationsItems: [
            "Access the internet or external data",
            "Modify tasks without your review (in Plan mode)",
            "Remember conversations from previous sessions"
        ] as readonly string[],
        remoteModeTag: "Remote model",
        localModeTag: "Local engine",
        remoteModeDescription:
            "Powered by a remote AI model. Your data is processed according to your privacy settings.",
        localModeDescription:
            "Running on a local AI engine. Your data stays on this device.",
        knowledgeCutoffTemplate: "Knowledge cutoff: {date}",
        serverLimitsTitle: "Server-advertised limits",
        serverMetadataLoading: "Loading server details…",
        serverMetadataUnavailable: "Could not load server limits.",
        rateLimitLine: "Rate limit: {perMinute} / min · {perHour} / hour",
        monthlyBudgetCapLine:
            "Org monthly token budget cap: {cap} tokens (shared reservation model)",
        allowedAutonomyLabel: "Allowed autonomy",
        recursionLimitLine: "Recursion limit: {limit}",
        contextSchemaKeysLine: "Context schema keys: {keys}"
    },
    mutation: {
        riskHigh: "High risk",
        riskMedium: "Medium risk",
        riskLow: "Low risk",
        undoable: "Undoable",
        undoLabel: "Undo",
        undoApplied: "Undone",
        undoAriaLabel: "Undo this proposal",
        undoCountdown: "Undo ({seconds}s)",
        undoCountdownAria: "Undo — {seconds}s remaining",
        undoAvailableAfterAccepting: "10s undo available after accepting",
        copilotProposes: "Copilot proposes: {description}",
        acceptingWillChange: "Accepting will change: {fields}",
        acceptingProposal: "Accepting this proposal…",
        applyToast: "Copilot applied a board change.",
        fields: {
            coordinator: "Coordinator",
            column: "Column",
            epic: "Epic",
            type: "Type",
            storyPoints: "Story points",
            taskName: "Task name",
            note: "Notes"
        },
        diffColumns: {
            field: "Field",
            current: "Current",
            proposed: "Proposed"
        },
        columnFieldLabel: "Column {field}",
        /*
         * QW#10 (2026-05 review §Quick Wins): the Apply button now
         * shows the action verb matching the kind of mutation the
         * agent proposed, derived from the diff shape (the wire schema
         * doesn't carry an explicit `kind` — see `interfaces/agent.d.ts`).
         * Surfaces that want to bypass the inferred verb can still pass
         * a `title` override on `MutationProposalCard`.
         */
        applyVerbs: {
            create: "Create",
            update: "Save changes",
            delete: "Delete",
            move: "Move",
            reassign: "Reassign",
            renameColumn: "Rename"
        }
    },
    /**
     * Web Share Target landing-page microcopy (Phase 3 A4). The page
     * receives the share intent payload via URL params from the manifest's
     * `share_target.action = "/share"` entry and surfaces a project +
     * column picker so the user can drop the shared content straight onto
     * a board. Microcopy lives here so both English and zh-CN translators
     * can review it as a single block.
     */
    share: {
        headline: "Share to Pulse",
        summary: "Create a task from the content you shared.",
        summaryTitle: "Title",
        summaryText: "Text",
        summaryUrl: "URL",
        projectLabel: "Project",
        columnLabel: "Column",
        emptyTitle: "Create your first project to start sharing",
        emptyDescription:
            "Pulse needs at least one project before you can share content into it.",
        nothingTitle: "Nothing to share yet",
        nothingDescription:
            "Open Pulse from another app's share sheet to pre-fill a task here."
    },
    swUpdate: {
        title: "New version available",
        description:
            "A new build of Pulse is ready. Reload to pick up the latest fixes.",
        reload: "Reload",
        dismiss: "Later",
        ariaLabel: "New version available notification"
    },
    pullToRefresh: {
        pull: "Pull to refresh",
        release: "Release to refresh",
        refreshing: "Refreshing…"
    },
    /*
     * Phase 6 Wave 6 — swipe-to-action pane labels. The visible (and
     * AT-decorative) caption shown under the icon in a SwipeableRow's
     * revealed action pane. Delete reuses `actions.delete`; these two are
     * the standalone favorite/unfavorite verbs the heart toggle's
     * `{name}`-templated aria-labels (`a11y.likeProject` /
     * `a11y.unlikeProject`) can't double as in a compact pane.
     */
    swipeActions: {
        favorite: "Favorite",
        unfavorite: "Unfavorite"
    },
    /*
     * Phase 4.4 — first-login onboarding tour. A lightweight, one-shot
     * AntD <Tour> that introduces the primary navigation and Board
     * Copilot on the first authenticated visit, then never auto-shows
     * again. Copy stays short and welcoming — this is a nicety, not a
     * blocking modal. `next` / `previous` / `done` / `skip` override the
     * AntD Tour locale defaults so both languages read consistently.
     */
    onboardingTour: {
        next: "Next",
        previous: "Back",
        done: "Done",
        skip: "Skip tour",
        welcome: {
            title: "Welcome to Pulse",
            description:
                "Here is a quick tour of the essentials. You can skip it anytime — it only shows once."
        },
        navigation: {
            title: "Find your way around",
            description:
                "Jump between your boards, inbox, and Copilot from here whenever you need to."
        },
        copilot: {
            title: "Meet Board Copilot",
            description:
                "Board Copilot drafts tasks, breaks down work, and answers questions about your boards. Turn it on or off anytime."
        },
        account: {
            title: "Your account and settings",
            description:
                "Switch themes, change language, and sign out from your account menu."
        }
    }
} as const;

export default enSource;
