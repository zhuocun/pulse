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
        resetFilters: "Reset filters",
        retry: "Retry",
        save: "Save",
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
        loadingProjects: "Loading projects",
        loadingPage: "Loading page",
        projects: "Projects",
        searchProjectsByName: "Search projects by name",
        searchTasksByName: "Search tasks by name",
        filterByManager: "Filter by manager",
        filterByCoordinator: "Filter by coordinator",
        filterByType: "Filter by type",
        newColumnName: "New column name",
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
        applyReadinessSuggestion: "Apply readiness suggestion for {field}"
    },
    dragHints: {
        taskCardKeyboard:
            "Keyboard drag: Space to lift, arrow keys to move, Space to drop, Escape to cancel.",
        columnDragHandle: "Drag to reorder column"
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
        logout: "Log out",
        pageTitle: "Settings",
        pageSubtitle: "Choose your theme, language, and Copilot preferences."
    },
    /**
     * Bottom tab bar (Phase 3 A3). Surfaces the four primary destinations
     * on `pointer: coarse` viewports. Labels stay short so the 25vw tab
     * width keeps the icon + label legible without truncation.
     */
    nav: {
        primaryLandmarkLabel: "Primary",
        tabs: {
            boards: "Boards",
            inbox: "Inbox",
            copilot: "Copilot",
            profile: "Profile"
        }
    },
    inbox: {
        emptyTitle: "Your inbox is empty",
        emptyDescription:
            "Triage proposals, mentions, and AI activity will appear here.",
        heading: "Inbox"
    },
    copilotLanding: {
        heading: "Copilot",
        subtitle: "Ask a question or open a brief for the current board.",
        askTitle: "Ask Copilot",
        askDescription: "Pose a question about your boards, tasks, or members.",
        briefTitle: "Open Board brief",
        briefDescription: "See a one-glance summary of the active board.",
        aiDisabledTitle: "AI is off",
        aiDisabledDescription:
            "Turn on Board Copilot in Settings to use the Copilot tab."
    },
    labels: {
        members: "Members",
        teamMembers: "Team members",
        board: "Board",
        project: "Project",
        briefShort: "Brief",
        copilotShort: "Copilot",
        askShort: "Ask",
        noOrganization: "No organization"
    },
    fields: {
        column: "Column",
        coordinator: "Coordinator",
        email: "Email",
        epic: "Epic",
        manager: "Manager",
        notes: "Notes",
        organization: "Organization",
        password: "Password",
        projectName: "Project name",
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
        selectStoryPoints: "Select story points",
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
        sort: {
            nameAsc: "Name (A → Z)",
            nameDesc: "Name (Z → A)",
            newest: "Newest first",
            oldest: "Oldest first"
        },
        taskTypes: {
            task: "Task",
            bug: "Bug"
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
        smartMatch: "Smart match"
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
        likeFailed: "Couldn't update like. Please try again.",
        taskSaved: "Task saved",
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
        projects: "Projects"
    },
    board: {
        title: "Board",
        titleWithName: "{name} board",
        swipeHint: "Swipe to see more columns",
        enableCopilotOnBoard: "Enable on this board",
        copilotMenuAsk: "Ask Copilot",
        copilotMenuBrief: "Board brief",
        copilotProjectDisabledDescription:
            "Hides Board Copilot on this board and blocks AI requests for this project."
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
        discardEdits: "Discard edits"
    },
    projectsPage: {
        title: "Projects",
        subtitle:
            "Browse the boards your team is shipping. Filter, search, or create a new project to start tracking work.",
        totalProjects: "Total projects",
        organizations: "Organizations",
        teamMembers: "Team members",
        loadingStats: "Loading project stats",
        statsAnnouncement:
            "{total} projects across {organizations} organizations, {members} team members."
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
        projects: "Projects",
        inbox: "Inbox",
        copilot: "Copilot",
        settings: "Settings",
        share: "Share to Pulse"
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
            "Auto requires an agent that supports preapproved tools. Available in v3."
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
            project: "project",
            task: "task",
            column: "column",
            member: "member"
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
        countsPerColumn: "Counts per column",
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
        columnFieldLabel: "Column {field}"
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
        create: "Create task",
        cancel: "Cancel",
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
    }
} as const;

export default enSource;
