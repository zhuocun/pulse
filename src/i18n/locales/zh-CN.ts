/**
 * 简体中文 (Simplified Chinese) translation of the central microcopy bundle.
 *
 * Keep the keys in lock-step with `src/constants/microcopy.ts` — the
 * `Dictionary` type below makes a missing key a compile error so we never
 * silently fall through to undefined at runtime.
 *
 * Brand names ("Pulse", "Copilot") and abbreviations ("AI") are intentionally
 * left in their native form — they read more naturally in product copy and
 * match how Chinese users encounter them in marketing.
 *
 * Token placeholders inside strings (e.g. `{name}`, `{seconds}`, `{origin}`)
 * must be preserved verbatim — call sites pass them through `String#replace`
 * after looking up the localized string.
 */
import type { Dictionary } from "../types";

const zhCN: Dictionary = {
    actions: {
        addColumn: "添加栏",
        apply: "应用",
        askCopilot: "询问 Copilot",
        breakDown: "拆分",
        cancel: "取消",
        clear: "清除",
        clearAiSearch: "清除 AI 搜索",
        close: "关闭",
        copyAsMarkdown: "以 Markdown 格式复制",
        create: "创建",
        createProject: "创建项目",
        createTask: "创建任务",
        delete: "删除",
        draftTask: "起草任务",
        draftWithAi: "使用 AI 起草",
        edit: "编辑",
        editProject: "编辑项目",
        editTask: "编辑任务",
        logIn: "登录",
        loggingIn: "登录中…",
        logOut: "退出登录",
        registerCta: "注册账号",
        loginCta: "登录账号",
        refresh: "刷新",
        resetFilters: "重置筛选",
        retry: "重试",
        save: "保存",
        saveAsDefault: "保存为默认",
        resetToDefault: "恢复为默认",
        savedAsDefault: "已保存为默认",
        defaultApplied: "已应用默认",
        search: "搜索",
        send: "发送",
        showPassword: "显示密码",
        hidePassword: "隐藏密码",
        showReasoning: "查看依据",
        signUp: "注册",
        signingUp: "注册中…",
        sort: "排序",
        stop: "停止",
        undo: "撤销"
    },
    validation: {
        emailRequired: "请输入邮箱",
        emailInvalid: "请输入有效的邮箱地址",
        passwordRequired: "请输入密码",
        passwordTooShort: "密码至少需要 8 个字符",
        usernameRequired: "请输入用户名",
        projectNameRequired: "请输入项目名称",
        organizationRequired: "请输入组织名称",
        managerRequired: "请选择负责人",
        coordinatorRequired: "请选择协调人",
        taskNameRequired: "请输入任务名称",
        taskTypeRequired: "请选择任务类型"
    },
    a11y: {
        capsLockOn: "大写锁定已开启",
        loadingProject: "正在加载项目",
        loadingProjectName: "正在加载项目名称",
        loadingBoard: "正在加载看板",
        accountMenu: "账户菜单",
        accountMenuFor: "{name} 的账户菜单",
        boardCopilot: "看板 Copilot",
        boardCopilotProjectToggle: "此项目的看板 Copilot",
        boardCopilotSettings: "看板 Copilot 设置",
        boardCopilotMenu: "看板 Copilot 菜单",
        boardCopilotWelcome: "看板 Copilot 欢迎信息",
        aboutBoardCopilot: "关于看板 Copilot",
        dismissSwipeHint: "关闭滑动提示",
        aiSuggestion: "AI 建议",
        aiBadge: "AI · 使用前请审核",
        useDarkMode: "切换到深色模式",
        useLightMode: "切换到浅色模式",
        goToProjects: "前往项目列表",
        skipToMainContent: "跳转到主要内容",
        members: "成员",
        viewTeamMembers: "查看团队成员",
        switchProject: "切换项目",
        filterProjects: "筛选项目",
        filterTasks: "筛选任务",
        activeFilters: "当前筛选条件",
        removeFilter: "移除 {label} 筛选",
        sortProjects: "项目排序",
        projectPagination: "项目列表分页",
        favoritedOnlyToggle: "仅显示已收藏的项目",
        saveCurrentAsDefault: "将当前筛选保存为默认",
        resetToSavedDefault: "重置筛选为已保存的默认",
        loadingProjects: "正在加载项目",
        loadingPage: "正在加载页面",
        projects: "项目",
        searchProjectsByName: "按名称搜索项目",
        searchTasksByName: "按名称搜索任务",
        filterByManager: "按负责人筛选",
        filterByCoordinator: "按协调人筛选",
        filterByType: "按类型筛选",
        newColumnName: "新列名称",
        newTaskName: "新任务名称",
        taskPrompt: "任务提示词",
        breakdownAxisLabel: "拆分维度",
        draftTaskWithCopilot: "使用 Copilot 起草任务",
        breakPromptIntoSubtasks: "将提示词拆分为子任务",
        creatingSubtasks: "正在创建子任务",
        subtaskBreakdown: "子任务拆分",
        includeSubtask: "包含子任务 {name}",
        deleteTask: "删除 {name}",
        rejectProposal: "拒绝提议",
        acceptProposal: "接受提议",
        copyBriefAsMarkdown: "以 Markdown 格式复制简报",
        generatingBrief: "正在生成简报",
        boardBriefContent: "看板简报内容",
        messageBoardCopilot: "向看板 Copilot 发送消息",
        sendMessage: "发送消息",
        samplePrompts: "示例提示词",
        exitBoardCopilotMode: "退出看板 Copilot 模式",
        switchToBoardCopilot: "切换到看板 Copilot",
        boardCopilotModeAnnouncement: "看板 Copilot 模式。按回车键提问。",
        openBoardCopilotBrief: "打开看板 Copilot 简报",
        openCopilotPanel: "打开 Copilot 面板",
        editMessage: "编辑消息",
        copyResponse: "复制回答",
        regenerateResponse: "重新生成回答",
        helpfulAnswer: "有帮助的回答",
        notHelpfulGiveFeedback: "没有帮助 — 提供反馈",
        showAllSources: "显示全部 {count} 个来源",
        trySamplePrompt: "尝试示例提示词：{prompt}",
        tryFollowUp: "尝试追问：{prompt}",
        openTask: "打开任务 {name}",
        assignedTo: "已分配给 {name}",
        deleteColumnNamed: "删除列 {name}",
        moreActionsForColumn: "{name} 列的更多操作",
        moreActionsForProject: "{name} 的更多操作",
        likeProject: "收藏 {name}",
        unlikeProject: "取消收藏 {name}",
        applyReadinessSuggestion: "应用 {field} 的就绪建议",
        lensChips: "看板视图",
        lensComingSoon: "敬请期待",
        renameTask: "重命名任务",
        columnReadinessReady: "{total} 个任务中已就绪 {ready} 个",
        columnReadinessGrooming: "{total} 个任务中已就绪 {ready} 个 — 需要整理",
        confidenceAriaLabel: "置信度 {band}，{percent}"
    },
    dragHints: {
        taskCardKeyboard:
            "键盘拖拽：按空格键提起，方向键移动，再按空格键放下，按 Esc 取消。",
        columnDragHandle: "拖动以重新排序列",
        reorderDisabledByFilters:
            "筛选启用时暂停重新排序。清除筛选后即可拖动排序。"
    },
    shortcuts: {
        dialogTitle: "键盘快捷键",
        dialogDescription: "使用这些键盘快捷键加快你的操作。",
        sequenceThen: "然后",
        scopes: {
            global: "全局",
            projectPage: "项目页面",
            board: "看板",
            taskCard: "聚焦的任务卡片",
            overlay: "弹窗与抽屉"
        },
        descriptions: {
            openCommandPalette: "打开命令面板",
            openShortcutHelp: "打开键盘快捷键帮助",
            goToProjects: "前往项目",
            goToBoard: "前往看板",
            createTask: "在聚焦的列中创建任务",
            closeOverlay: "关闭打开的弹窗或抽屉",
            editTask: "为聚焦的任务打开编辑弹窗",
            keyboardDragTask: "使用键盘拖动聚焦的任务"
        }
    },
    labels: {
        members: "成员",
        teamMembers: "团队成员",
        board: "看板",
        project: "项目",
        projectSections: "项目分区",
        reports: "报告",
        briefShort: "简报",
        copilotShort: "Copilot",
        askShort: "提问",
        noOrganization: "暂无组织"
    },
    settings: {
        darkMode: "深色模式",
        toggleDarkMode: "切换深色模式",
        boardCopilot: "看板 Copilot",
        toggleBoardCopilot: "启用看板 Copilot 功能",
        language: "语言",
        changeLanguage: "切换语言",
        theme: "主题",
        themeLight: "浅色",
        themeDark: "深色",
        themeSystem: "跟随系统",
        aiEnabled: "看板 Copilot",
        pageTitle: "设置",
        pageSubtitle: "选择您的主题、语言和 Copilot 偏好设置。",
        // Phase 5 Wave 2 T4 — Liquid Glass intensity toggle. The
        // "Auto" option defers to the per-device ladder; the other
        // three are explicit overrides that always win.
        glassIntensity: "玻璃",
        changeGlassIntensity: "切换玻璃强度",
        glassIntensityAuto: "自动",
        glassIntensityClear: "通透",
        glassIntensityRegular: "标准",
        glassIntensitySolid: "实心",
        // 运行时配色切换。标签旁是六选一的 Segmented 控件（每个配色一项），
        // 每项在单字色名旁显示品牌主色样本。橙色为默认；其余配色会实时
        // 重新着色整个应用。
        colorTheme: "配色",
        changeColorTheme: "切换配色",
        colorThemeOrange: "橙色",
        colorThemeBlue: "蓝色",
        colorThemeEmerald: "翡翠绿",
        sections: {
            appearance: {
                header: "外观",
                footer: "主题和语言将应用于您的所有设备。"
            },
            copilot: {
                footer: "看板 Copilot 使用 AI 起草和拆分工作。您可以随时关闭。"
            },
            account: {
                header: "账户",
                footer: "在此设备上退出 Pulse。"
            }
        }
    },
    nav: {
        primaryLandmarkLabel: "主导航",
        desktopNavLabel: "主导航栏",
        tabs: {
            boards: "看板",
            inbox: "收件箱",
            copilot: "Copilot",
            profile: "我的",
            search: "搜索"
        }
    },
    inbox: {
        emptyTitle: "收件箱为空",
        emptyDescription: "整理提议、提及和 AI 活动将显示在此处。",
        heading: "收件箱",
        sections: {
            triage: {
                title: "待处理",
                empty: "暂无待审核的提议。Board Copilot 会在每个看板上推送待处理提醒。"
            },
            mentions: {
                title: "提及",
                empty: "暂无提及。"
            },
            activity: {
                title: "活动"
            }
        }
    },
    /*
     * Phase 4.7 报告占位页面。该路由是「我们听到了」的页面,
     * 在指标引擎上线之前先建立 URL 和导航位。文案有意传达
     * 「即将到来,期待您的反馈」而非含糊的「即将推出」,
     * 让用户知道团队正在倾听功能请求。
     */
    reports: {
        heading: "报告",
        emptyTitle: "报告功能即将推出",
        emptyDescription:
            "速度图、燃尽图等项目指标即将到来。我们正在倾听 — 告诉我们您最想看到什么。",
        feedbackCta: "分享反馈",
        feedbackHref:
            "mailto:feedback@pulse.app?subject=Reports%20feedback&body=Tell%20us%20what%20you%27d%20like%20to%20see%20in%20Reports."
    },
    copilotLanding: {
        heading: "Copilot",
        subtitle: "提出问题或为当前看板打开简报。",
        askTitle: "询问 Copilot",
        askDescription: "针对您的看板、任务或成员提出问题。",
        briefTitle: "打开看板简报",
        briefDescription: "查看当前看板的一目了然摘要。",
        aiDisabledTitle: "AI 已关闭",
        aiDisabledDescription:
            "请在设置中启用看板 Copilot 以使用 Copilot 选项卡。"
    },
    fields: {
        column: "列",
        coordinator: "协调人",
        email: "邮箱",
        epic: "史诗",
        manager: "负责人",
        notes: "备注",
        organization: "组织",
        password: "密码",
        projectName: "项目名称",
        storyPoints: "故事点",
        taskName: "任务名称",
        type: "类型",
        username: "用户名"
    },
    placeholders: {
        emailExample: "name@example.com",
        searchProjects: "在此列表中搜索",
        searchBoard: "在此看板中搜索",
        managers: "全部负责人",
        manager: "负责人",
        coordinators: "全部协调人",
        coordinator: "协调人",
        types: "全部类型",
        type: "类型",
        selectCoordinator: "请选择协调人",
        selectType: "请选择类型",
        selectManager: "请选择负责人",
        selectStoryPoints: "请选择故事点",
        createColumnName: "新建列名称",
        whatNeedsToBeDone: "需要完成什么?",
        notesAcceptanceCriteria: "备注 / 验收标准",
        chatAsk: "提出问题…(Shift+Enter 换行)",
        commandPaletteNav: "搜索项目、任务、列、成员…",
        commandPaletteAi: "向看板 Copilot 提问…",
        taskPromptExample: "例如:排查 Safari 上偶发的登录失败,影响 v2 发布",
        describeWork: "用您自己的话描述这项工作"
    },
    options: {
        projectListSort: {
            createdAtDesc: "最新优先",
            createdAtAsc: "最旧优先",
            nameAsc: "名称(A → Z)",
            nameDesc: "名称(Z → A)",
            favoritedFirst: "收藏优先"
        },
        taskTypes: {
            task: "任务",
            bug: "缺陷"
        }
    },
    counts: {
        projects: {
            one: "{count} 个项目",
            other: "{count} 个项目"
        },
        tasksMatchingActiveFilters: {
            one: "{count} 个任务匹配当前筛选条件",
            other: "{count} 个任务匹配当前筛选条件"
        },
        results: {
            one: "{count} 项结果",
            other: "{count} 项结果"
        },
        targets: {
            one: "{count} 个目标",
            other: "{count} 个目标"
        },
        subtasksCreated: {
            one: "已创建 {count} 个子任务。",
            other: "已创建 {count} 个子任务。"
        },
        subtasksRemoved: {
            one: "已移除 {count} 个子任务。",
            other: "已移除 {count} 个子任务。"
        },
        subtasksRemoveFailed: {
            one: "无法移除 {count} 个子任务。",
            other: "无法移除 {count} 个子任务。"
        },
        subtasksRemovedPartial: "已移除 {removed} 个,有 {failed} 个无法移除。",
        createNSubtasks: "创建 {count} 个子任务"
    },
    chips: {
        search: "搜索",
        manager: "负责人",
        coordinator: "协调人",
        type: "类型",
        ai: "AI",
        smartMatch: "智能匹配",
        favoritedOnly: "已收藏",
        favoritedOnlyOn: "是"
    },
    /**
     * Phase 3 A7 — 看板筛选视图。`comingSoonBadge` 出现在依赖 ITask 的
     * 新字段（dueDate、aiRisk —— Phase 4）的视图上，提示用户该视图当前
     * 不会进行筛选，但已经在规划中。
     */
    lenses: {
        today: "今天",
        thisWeek: "本周",
        mine: "我的",
        atRisk: "存在风险",
        todayTooltip: "今天到期的任务",
        thisWeekTooltip: "本周内（周一至周日）到期的任务",
        mineTooltip: "你作为协调人的任务",
        atRiskTooltip: "AI 标记为高或中风险的任务",
        comingSoonBadge: "敬请期待"
    },
    confirm: {
        deleteProject: {
            title: "确认删除该项目?",
            description: "此操作无法撤销。",
            confirmLabel: "删除项目"
        },
        deleteColumn: {
            title: "确认删除该列?",
            description: "此操作无法撤销。",
            confirmLabel: "删除列"
        },
        deleteTask: {
            title: "确认删除该任务?",
            description: "此操作无法撤销。",
            confirmLabel: "删除任务"
        },
        discardChanges: {
            title: "放弃更改?",
            description: "未保存的更改将会丢失。",
            confirmLabel: "放弃",
            cancelLabel: "继续编辑"
        }
    },
    feedback: {
        loadFailed: "加载失败,请重试。",
        saveFailed: "保存失败,请重试。",
        operationFailed: "操作失败",
        retryHint: "请检查网络连接后重试。",
        noManager: "暂无负责人",
        noDate: "暂无日期",
        renderFailed: "页面渲染失败。",
        renderFailedHint: "请重试,如问题持续请刷新页面。",
        reloadPage: "重新加载页面",
        networkError: "无法连接,请检查网络连接后重试。",
        optimisticReverted: "保存失败 — 您的更改已撤销。",
        projectDeleted: "项目已删除",
        taskDeleted: "任务已删除",
        columnDeleted: "列已删除",
        likeFailed: "点赞更新失败,请重试。",
        taskSaved: "任务已保存",
        welcomeBack: "欢迎回来!",
        loginFailedNoToken: "登录响应中缺少会话令牌,请重试。",
        loginCouldNotPersistSession:
            "无法保存会话。请关闭无痕浏览或允许本站存储数据后重试。",
        accountCreated: "账号已创建,请登录。",
        couldntDeleteTask: "无法删除「{name}」。",
        couldntCopy: "复制失败",
        couldntGenerateBrief: "无法生成简报",
        searchFailed: "搜索失败,请重试。",
        searchFailedTitle: "搜索失败",
        searching: "搜索中",
        searchingTag: "搜索中…",
        resultsFiltered: "已筛选结果。{rationale}",
        noTasksMatched: "没有匹配的任务。请换一种说法,或清除以查看全部。",
        boardEmpty: "此看板暂无任务。",
        taskAssistTitle: "{section}：对本条任务协助建议评分",
        boardBriefTitle: "{section}：对本条看板简报建议评分"
    },
    greeting: "你好，{name}",
    header: {
        logoLabel: "Pulse 首页"
    },
    breadcrumb: {
        projects: "项目",
        reports: "报告"
    },
    board: {
        title: "看板",
        titleWithName: "{name} 看板",
        enableCopilotOnBoard: "在此看板启用",
        swipeHint: "滑动查看更多列",
        copilotMenuAsk: "询问 Copilot",
        copilotMenuBrief: "看板简报",
        copilotMenuProjectOff: "关闭项目 AI",
        copilotProjectDisabledDescription:
            "在此看板隐藏看板 Copilot,并阻止此项目发起 AI 请求。",
        densityLabel: "看板密度",
        densityComfortable: "宽松",
        densityCompact: "紧凑",
        presets: {
            saveAction: "保存当前筛选为预设…",
            saveAriaLabel: "保存当前筛选为预设",
            namePlaceholder: "预设名称",
            saveConfirm: "保存",
            saveCancel: "取消",
            loadAriaLabel: "加载已保存的筛选预设",
            loadPlaceholder: "已保存的预设",
            deleteAriaLabel: "删除预设 {name}",
            limitReachedBody:
                "最多可保存 {limit} 个预设。请先删除一个再保存新预设。",
            saved: "预设已保存",
            applied: "已应用预设 {name}",
            staleValueWarning: "此预设中部分值已不存在,已跳过。"
        },
        minimap: {
            aria: "看板缩略图",
            segmentAriaOne: "{name} 列,1 个任务,当前{status}",
            segmentAriaOther: "{name} 列,{count} 个任务,当前{status}",
            inViewStatus: "在视图中",
            offScreenStatus: "在视图外"
        }
    },
    projectModal: {
        createDescription: "设置名称、组织和负责人,开始跟踪工作。",
        editDescription: "更新项目详情和分配信息。"
    },
    taskModal: {
        removedByOthersTitle: "此任务已被其他更改移除。",
        removedByOthersBody: "您的编辑仍在此。请丢弃或保存为新任务以保留更改。",
        discardEdits: "丢弃更改",
        aiAssistLabel: "AI 辅助"
    },
    taskDetailPanel: {
        confirmDiscardTitle: "放弃未保存的更改?",
        confirmDiscardBody: "对此任务的编辑将会丢失。",
        confirmDiscardOk: "放弃",
        confirmDiscardCancel: "继续编辑",
        siblingNextLabel: "下一个任务",
        siblingPrevLabel: "上一个任务",
        siblingPositionLabel: "第 {position} 个,共 {total} 个",
        ariaLabel: "任务详情",
        siblingNavAriaLabel: "同级任务导航"
    },
    copilotDock: {
        title: "Copilot",
        ariaLabel: "Copilot 工作台",
        closeLabel: "关闭 Copilot",
        tabChat: "聊天",
        tabBrief: "简报",
        tabListLabel: "Copilot 视图",
        inboxTab: {
            title: "收件箱",
            emptyTitle: "已全部处理完毕",
            emptyDescription: "Copilot 发现看板问题时,会在这里推送提醒。",
            seeAll: "在收件箱查看全部",
            unreadBadgeAriaLabelOne: "{count} 条未读 Copilot 提醒",
            unreadBadgeAriaLabelOther: "{count} 条未读 Copilot 提醒",
            sectionLabel: "整理提醒",
            actionLabel: "打开任务",
            dismissLabel: "忽略"
        }
    },
    activityFeed: {
        bellAriaLabelZero: "活动通知,暂无新通知",
        bellAriaLabelOne: "活动通知,{count} 条未读",
        bellAriaLabelOther: "活动通知,{count} 条未读",
        drawerTitle: "活动",
        drawerCloseLabel: "关闭活动抽屉",
        markAllRead: "全部标记为已读",
        markAllReadAriaLabel: "将所有活动标记为已读",
        empty: "目前没有新的动态。这里会显示新发生的活动。",
        groupToday: "今天",
        groupYesterday: "昨天",
        groupEarlier: "更早",
        relativeJustNow: "刚刚",
        relativeOneMinute: "1 分钟前",
        relativeMinutes: "{count} 分钟前",
        relativeOneHour: "1 小时前",
        relativeHours: "{count} 小时前",
        relativeOneDay: "1 天前",
        relativeDays: "{count} 天前",
        undo: "撤销",
        undoAriaLabel: "撤销:{summary}",
        undoFailedToast: "无法撤销:{error}",
        kindLabels: {
            task: "任务",
            column: "列",
            project: "项目",
            ai: "AI"
        },
        descriptions: {
            taskCreated: "已创建任务 “{name}”",
            taskUpdated: "已更新任务 “{name}”",
            taskDeleted: "已删除任务 “{name}”",
            taskRenamed: "任务已重命名为 “{name}”",
            taskMoved: "已将 “{taskName}” 从 {fromColumn} 移动到 {toColumn}",
            columnCreated: "已创建列 “{name}”",
            columnUpdated: "已更新列 “{name}”",
            columnDeleted: "已删除列 “{name}”",
            columnRenamed: "列已重命名为 “{name}”",
            projectCreated: "已创建项目 “{name}”",
            projectUpdated: "已更新项目 “{name}”",
            projectDeleted: "已删除项目 “{name}”"
        }
    },
    aiActivityLog: {
        pillLabel: "本次会话中有 {count} 项 AI 变更",
        pillLabelPlural: "本次会话中有 {count} 项 AI 变更",
        pillAriaExpanded: "隐藏 AI 活动日志",
        pillAriaCollapsed: "显示 AI 活动日志",
        listTitle: "本次会话的 AI 活动",
        revert: "撤销",
        revertAriaLabel: "撤销:{description}",
        revertUnavailable: "刷新后此条目不可撤销。",
        clearAll: "全部清除",
        clearConfirmTitle: "清除 AI 活动日志?",
        clearConfirmBody: "将移除本次会话的所有条目。已应用的更改仍会保留。",
        clearConfirmOk: "清除",
        clearConfirmCancel: "保留",
        emptyState: "暂无记录 —— 采用 AI 建议后会显示在这里。",
        undoFailedToast: "无法撤销:{error}",
        relativeJustNow: "刚刚",
        relativeOneMinute: "1 分钟前",
        relativeMinutes: "{count} 分钟前",
        relativeOneHour: "1 小时前",
        relativeHours: "{count} 小时前",
        relativeOneDay: "1 天前",
        relativeDays: "{count} 天前",
        surfaceLabels: {
            "task-assist": "任务助手",
            "task-draft": "任务草稿",
            "mutation-proposal": "变更提案"
        },
        descriptions: {
            taskAssistPointsApplied: "将 “{taskName}” 的故事点应用为 {points}",
            taskAssistFieldApplied: "为 “{taskName}” 的 {field} 应用了 AI 建议",
            taskDraftCreated: "已根据 AI 草稿创建任务 “{taskName}”",
            mutationProposalApplied: "已应用变更:{description}"
        }
    },
    projectsPage: {
        title: "项目",
        subtitle:
            "浏览您的团队正在推进的看板。筛选、搜索,或创建一个新项目来开始跟踪工作。",
        totalProjects: "项目总数",
        organizations: "组织数",
        teamMembers: "团队成员",
        loadingStats: "正在加载项目统计",
        statsAnnouncement:
            "{total} 个项目,涵盖 {organizations} 家组织,{members} 名团队成员。"
    },
    pageTitle: {
        login: "登录",
        register: "注册",
        forgotPassword: "重置密码",
        terms: "服务条款",
        projects: "项目",
        inbox: "收件箱",
        copilot: "Copilot",
        settings: "设置",
        share: "分享到 Pulse",
        /*
         * Phase 4.7: 项目报告着陆页。项目名称在页面层级插入 ——
         * 详见 `pages/reports.tsx`。在项目查询完成前回退到无名版本。
         */
        reports: "报告",
        reportsWithProject: "报告 · {project}"
    },
    empty: {
        projects: {
            title: "暂无项目",
            description: "创建您的第一个项目,开始追踪工作、负责人和进度。"
        },
        board: {
            title: "添加您的第一列",
            description:
                "看板将任务组织到不同的列中。可尝试:待办、进行中、已完成。",
            cta: "创建第一列"
        },
        members: {
            title: "暂无团队成员",
            description: "邀请同事一起协作此工作区。"
        },
        chat: {
            title: "向看板 Copilot 提问",
            description:
                "试试:「有什么风险?」或「谁的待办任务最多?」 — 答案来源于您的看板数据。"
        },
        filteredColumn: {
            title: "没有任务匹配当前筛选条件",
            cta: "重置筛选"
        },
        savedPresets: {
            empty: "暂无已保存的预设。"
        },
        commandPalette: {
            loading: "加载中…",
            empty: "未找到匹配项。"
        },
        notFound: {
            title: "页面不存在",
            description: "找不到您要访问的页面,该页面可能已迁移或链接已过期。",
            cta: "返回项目列表"
        }
    },
    ai: {
        draftSuggestions: [
            "起草一项缺陷修复任务",
            "规划一项新功能",
            "创建一项研究探索"
        ],
        chatSuggestions: [
            "这个看板有哪些风险?",
            "谁的待办任务最多?",
            "总结一下这个看板"
        ],
        followUpChips: {
            riskFromDue: "看看这个看板上哪些任务有风险",
            workOnPerson: "{name} 在做什么?",
            defaults: ["总结这个看板", "有什么被阻塞?", "今天有哪些变化?"]
        },
        privacyTitle: "看板 Copilot 可以看到的信息",
        privacyDisclosure:
            "看板 Copilot 使用看板和项目名称、列、任务名称、类型、故事点、史诗、备注(如有),以及成员的用户名、邮箱或必要的用户 ID。",
        privacyDataScope: [
            "看板和项目名称,以及列标题",
            "任务名称、类型、故事点、史诗、备注(如有)以及所属列",
            "成员的用户名、邮箱以及必要的用户 ID"
        ],
        privacyExclusions: "附件不会包含在看板 Copilot 的请求中。",
        localProcessingDisclosure:
            "此版本使用本地确定性的看板 Copilot 规则,不会有外部 AI 服务处理这些请求。",
        remoteProcessingDisclosure:
            "请求由配置的 AI 服务处理。系统会转发您的登录令牌,以便代理服务对您的账户授权。",
        remoteProcessingDisclosureWithOrigin:
            "请求由位于 {origin} 的 AI 服务处理。系统会转发您的登录令牌,以便代理服务对您的账户授权。",
        processingModeLocalLabel: "本地引擎",
        processingModeRemoteLabel: "远程 AI 服务",
        engineCapabilityLocal:
            "此版本的看板 Copilot 在本地按确定性的项目规则运行 — 未配置外部语言模型。建议反映的是规则,而非语言模型。",
        engineCapabilityRemote:
            "看板 Copilot 已连接到配置的 AI 服务。输出可能包含生成的内容,使用前请审核。",
        privacyLink: "共享了哪些信息?",
        privacyAcknowledge: "我知道了",
        privacySuppress: "不再提醒",
        streaming: "正在阅读您的看板数据…",
        stopped: "已停止",
        retryLabel: "重试",
        regenerateLabel: "重新生成",
        undoLabel: "撤销",
        storyPointsSetTo: "故事点已设为 {points}。",
        readinessUpdated: "已更新 {field}。",
        copiedConfirm: "已复制到剪贴板",
        feedbackThanks: "感谢您的反馈",
        feedbackImpactNotice:
            "反馈仅供产品团队复盘 — 不会改变本次回答,也不会用于训练模型。",
        feedbackThumbsDownTooltip:
            "回答没用?告诉我们原因。所选类别仅用于产品复盘,不会发送您的消息文本。",
        chatBusyError: "看板 Copilot 当前繁忙,请稍后再试。",
        errorBudgetHeading: "AI 额度已耗尽",
        errorBudgetBody: "该项目本期 AI 预算已用完,请联系管理员调整上限。",
        errorForbiddenHeading: "权限不足",
        errorForbiddenBody: "您无权在此项目中使用此 AI 功能。",
        errorNotFoundHeading: "智能助手不可用",
        errorNotFoundBody: "此 AI 功能未部署在所连接的服务器上。",
        errorServerHeading: "AI 服务出现问题",
        errorServerBody: "请稍后重试。",
        errorDefaultHeading: "看板 Copilot 出现错误",
        errorDefaultBody: "请重试,如问题持续请刷新页面。",
        watchdogTimeout: "看板 Copilot 响应超时,请重试。",
        unexpectedResponse: "看板 Copilot 返回了意外响应。",
        toolRoundExhausted: "无法完成回答(步骤过多),请换一个更具体的问题。",
        suggestedStoryPoints: "建议故事点",
        estimateTaskNameHint: "请先在上方输入任务名称以获取估算。",
        estimateConfidenceTooltip: "依据本看板中的相似任务。",
        estimatingPoints: "正在估算故事点",
        suggestedPointsAria: "建议故事点:{points}",
        applyPointsAria: "应用建议的故事点",
        similarTasks: "相似任务:",
        readinessCheck: "就绪检查",
        runningReadiness: "正在运行就绪检查",
        readinessReady: "看起来已准备就绪。",
        suggestionStatusLoading: "正在更新建议。",
        suggestionStatusReady: "建议已就绪。",
        suggestionStatusError: "无法加载建议。",
        briefStatusLoading: "正在生成简报。",
        briefStatusReady: "简报已就绪。",
        briefStatusError: "无法加载简报。",
        dismissNudge: "关闭",
        agentDegraded: "AI 后端响应缓慢（降级）",
        agentOffline: "AI 后端离线",
        completionAnnouncementOne: "{label} 回复了 {count} 个词。",
        completionAnnouncementOther: "{label} 回复了 {count} 个词。",
        citationSourceTask: "任务",
        citationSourceColumn: "列",
        citationSourceMember: "成员",
        citationSourceProject: "项目",
        citationSourceUser: "用户",
        citationAriaLabel: "引用 {index}：{source} {id}",
        feedbackPromptDownTitle: "哪里出了问题?",
        feedbackPromptDownHelper:
            "请至少选一项 — 这能帮助我们排查并优先修复,且不会发送您的消息文本。",
        feedbackCategories: {
            incorrect: "信息错误或编造",
            missingSource: "来源缺失或不准确",
            outdated: "使用了过期的看板数据",
            notActionable: "无法据此采取行动",
            unsafe: "建议存在风险",
            privacy: "隐私问题",
            other: "其他原因"
        },
        feedbackOptionalNote: "添加可选备注(不会发送您的消息文本)",
        feedbackSubmit: "发送反馈",
        feedbackSkip: "跳过",
        regeneratedBadge: "已重新生成的回答",
        regeneratedTooltip:
            "看板 Copilot 对同一问题生成了新的回答。先前的回答仍显示在上方供对比。",
        thinkingDefault: "正在阅读您的看板数据…",
        confidenceBands: {
            high: "高",
            moderate: "中",
            low: "低"
        },
        suggestedByCopilot: "由 Copilot 建议",
        appliedSuggestion: "由 Copilot 建议",
        appliedSuggestionShort: "AI",
        suggestionPopover: "看板 Copilot 已为您填写。可编辑或恢复至原值。",
        revertToPrevious: "恢复至上一个值",
        showAlternatives: "查看其他选项",
        showRationale: "为什么?",
        whyLabel: "为什么?",
        whyPopoverTitle: "Copilot 为何这样建议",
        applyAnyway: "仍然应用",
        emptyChatLead:
            "提问关于此看板、任务或您的项目。回答仅基于应用中的只读数据。",
        emptyBriefLead:
            "历史数据不足以分析趋势。随着看板的使用,简报会变得更智能。",
        emptyInbox: "目前没有提醒。看板 Copilot 每 15 分钟检查一次问题。",
        emptyHistory:
            "尚无 AI 操作记录。通过看板 Copilot 进行的更改会显示在此处。",
        rateLimit: "看板 Copilot 已达容量上限,请在 {seconds} 秒后重试。",
        projectDisabled: "此项目已关闭看板 Copilot。管理员可在设置中启用。",
        chatErrorRecovery:
            "未找到答案。请尝试换一种说法,或查看下方列出的来源。",
        chatNoSourcesCaveat:
            "本次回答未引用任何看板记录 — 采取行动前请先核实。",
        copilotLabel: "看板 Copilot",
        askCopilot: "询问看板 Copilot",
        findRelatedTasks: "查找相关任务",
        findRelatedProjects: "查找相关项目",
        findRelatedTasksAria: "用 AI 查找相关任务并筛选任务列表",
        findRelatedProjectsAria: "用 AI 查找相关项目并筛选项目列表",
        findRelatedTasksPlaceholder: "描述要查找的任务…",
        findRelatedProjectsPlaceholder: "描述要查找的项目…",
        findRelatedTasksHelper:
            "按任务名称、类型、史诗和备注匹配。仅筛选此列表 — 不会打开聊天。",
        findRelatedProjectsHelper:
            "按项目名称、组织和负责人匹配。仅筛选此列表 — 不会打开聊天。",
        searchMatchStrength: {
            strong: "强匹配",
            moderate: "部分匹配",
            weak: "弱匹配"
        },
        searchMatchStrengthAria: "AI 语义搜索的匹配强度:{strength}",
        searchSynonymExpanded:
            "已为「{original}」补充常见同义词({expansions})。",
        citationFlagAction: "举报来源不准确",
        citationFlagConfirm: "已收到 — 已标记待复盘",
        remoteConsentTitle: "提示:此版本会将数据发送到远程 AI",
        remoteConsentBody:
            "看板 Copilot 已连接到 {origin}。系统会将您的登录令牌、看板数据以及您打开的任何任务发送到该服务进行处理。输出可能包含生成的内容,使用前请审核。",
        remoteConsentBodyGeneric:
            "看板 Copilot 已连接到配置的 AI 服务。系统会将您的登录令牌、看板数据以及您打开的任何任务发送到该服务进行处理。输出可能包含生成的内容,使用前请审核。",
        remoteConsentAccept: "我已知悉",
        remoteConsentLearnMore: "共享了哪些信息?",
        newConversation: "新对话",
        newConversationConfirm: "开始新对话将清除当前全部历史记录。要继续吗？",
        startNew: "开始新的对话",
        stopResponse: "停止响应",
        chatResponding: "看板 Copilot 正在回复。",
        healthOffline: "看板 Copilot 当前不可用。请稍后再试。",
        healthDegraded: "看板 Copilot 正在延迟响应。回复可能较慢或暂时不可用。",
        healthIssueTemplate: "看板 Copilot 尚未就绪：{detail}",
        healthWarningTemplate: "看板 Copilot 已降级：{detail}",
        healthProviderUnreachableTemplate:
            "看板 Copilot 无法连接 {provider}：{detail}",
        healthProviderGeneric: "AI 提供方",
        healthStubMode:
            "看板 Copilot 已连接，但服务器正在使用 stub 提供方而不是真实 LLM。",
        healthRealProviderNotReady:
            "看板 Copilot 已连接，但没有真实 LLM 提供方就绪。",
        conversationTooLong: "对话过长。请开始新的会话，或尝试更短的消息。",
        conversationLongWarning:
            "当前对话已经较长。建议开始新的会话以保持回答质量。",
        sessionNotSaved: "会话不会保存 — 刷新页面后历史记录将被清除。",
        showFullResponse: "显示完整回答",
        stillThinking: "仍在思考…",
        jumpToLatest: "跳转到最新内容",
        moreSources: "+{count} 个更多来源",
        copiedShort: "已复制",
        copyMessage: "复制消息",
        copyMessageCopied: "已复制到剪贴板",
        toolDetailsToggle: "显示详情",
        toolDetailsHide: "隐藏详情",
        characterCountTemplate: "{count}/{max}",
        characterCountAtLimit: "{count}/{max} — 已达字符上限。",
        toolEmptyResult: "空结果",
        toolVerbs: {
            checkedProjects: "已检查项目",
            checkedTeamMembers: "已检查团队成员",
            checkedBoardColumns: "已检查看板列",
            checkedTasks: "已检查任务",
            openedProject: "已打开项目",
            openedTask: "已打开任务",
            lookedUpEvidence: "已查找依据"
        },
        requestedDataCouldNotBeLoaded: "无法加载请求的数据。",
        noProjectsFound: "未找到项目。",
        noTeamMembersFound: "没有团队成员。",
        noColumnsFound: "此看板中没有列。",
        noTasksFound: "没有匹配的任务。",
        checkedProjectsSummaryOne: "已检查 {count} 个项目。",
        checkedProjectsSummaryOther: "已检查 {count} 个项目。",
        checkedMembersSummaryOne: "已检查 {count} 个成员。",
        checkedMembersSummaryOther: "已检查 {count} 个成员。",
        checkedColumnsSummaryOne: "已检查 {count} 列。",
        checkedColumnsSummaryOther: "已检查 {count} 列。",
        checkedTasksSummaryOne: "已检查 {count} 个任务。",
        checkedTasksSummaryOther: "已检查 {count} 个任务。",
        openedProjectSummary: "已打开项目 **{name}**（组织：{organization}）。",
        openedTaskSummary: "已打开任务 **{name}**。",
        taskMetaLine: "类型：{type} · 点数：{points} · 史诗：{epic}",
        unownedSection: "未分配负责人：{names}",
        workloadSection: "工作负载：{entries}",
        generateBoardBriefPrompt: "为这个看板生成简报。",
        runBoardTriagePrompt: "对当前看板运行一次分诊检查。",
        storyPointsSet: "故事点已设置为 {points}。",
        readinessFieldUpdated: "已更新 {field}。",
        characterCounterMax: 4000,
        breakdownAxes: {
            by_phase: {
                label: "按阶段",
                tooltip: "前端、后端、测试"
            },
            by_surface: {
                label: "按界面",
                tooltip: "界面、API、数据、基础设施"
            },
            by_risk: {
                label: "按风险",
                tooltip: "高风险优先,低风险靠后"
            },
            freeform: {
                label: "由 Copilot 决定",
                tooltip: "由智能助手挑选最合适的拆分方式"
            }
        },
        welcomeBannerTitle: "看板 Copilot 已就绪",
        welcomeBannerBody:
            "起草任务、估算工作量、总结看板、回答问题 — 全部基于您的看板数据。",
        welcomeBannerCta: "试试:总结这个看板",
        welcomeBannerCtaPrompt: "总结这个看板",
        welcomeBannerDismiss: "关闭",
        whyThisResult: "为什么是这个结果?",
        didYouMean: "您是想搜索:",
        draftSamplePlanFeature: "为「{project}」规划一项功能",
        draftSampleFallbackProject: "本项目",
        reviewAndEdit: "创建前请审核并编辑",
        pickSubtasks: "选择您要创建的子任务",
        breakdownAxisInfo: "维度:{label}",
        bulkProgressFormat: "{current} / {total}",
        autonomyLabel: "Copilot 模式",
        autonomyLevelSuggest: "建议",
        autonomyLevelPlan: "计划",
        autonomyLevelAuto: "自动",
        autonomySelectorAriaLabel: "选择 Copilot 自主模式",
        autonomyAutoDisabledTooltip:
            "自动模式需要支持预批准工具的智能体,将在 v3 提供。",
        columnReadiness: {
            readyLabel: "已就绪",
            groomingLabel: "需整理",
            popoverTitleReady: "已就绪 · {ready}/{total}",
            popoverTitleGrooming: "需整理 · {ready}/{total}",
            popoverEmptyReady: "本列中的所有任务都已通过检查。",
            popoverBlockerListLabel: "仍需完善的任务"
        },
        ghostText: {
            acceptHint: "按 Tab 接受 · Esc 关闭",
            dismissAriaLabel: "关闭 Copilot 自动补全建议",
            srOnlySuggestionPrefix: "Copilot 建议:",
            srOnlySuggestionAccepted: "已接受建议。",
            srOnlySuggestionDismissed: "已关闭建议。"
        }
    },
    auth: {
        loginTitle: "登录账号",
        loginSubtitle: "输入邮箱和密码以继续。",
        forgotPassword: "忘记密码?",
        forgotPasswordPlaceholderTitle: "重置密码",
        forgotPasswordPlaceholderBody:
            "密码重置功能即将上线。如果您需要立即恢复访问权限，请联系工作区管理员。",
        registerTitle: "注册账号",
        registerSubtitle: "创建账号,开始追踪工作。",
        switchToRegister: "还没有账号?",
        switchToLogin: "已有账号?",
        backToLogin: "返回登录",
        errorSummaryTitle: "存在问题",
        errorSummaryIntro: "请修正以下项目后重试。",
        errorSummaryRegionAriaLabel: "表单错误",
        heroBadge: "新功能:看板 Copilot",
        heroTitle: "在专注与从容中推进工作。",
        heroSubtitle:
            "一款专注的项目看板,把工作转化为持续的进展。拖拽、起草(由 AI 协助),让团队保持心流。",
        heroFeatureDraft: "用 AI 起草任务和站会简报。",
        heroFeatureDrag: "拖放式的列与卡片。",
        heroFeatureColors: "支持浅色、深色及跟随系统的主题。",
        heroFinePrint: "为交付型团队打造。免费试用,无需信用卡。",
        passwordStrength: {
            meterAriaLabel: "密码强度",
            tooShort: "太短 — 请至少输入 8 个字符。",
            weak: "较弱 — 请混合使用大写字母、小写字母、数字或符号。",
            fair: "尚可 — 增加长度或再补充一种字符类型以提升强度。",
            strong: "强密码。"
        },
        termsLink: "服务条款",
        termsLoginPrefix: "登录即表示您同意我们的",
        termsLoginSuffix: "。",
        termsRegisterPrefix: "注册即表示您同意我们的",
        termsRegisterSuffix: "。",
        termsPageTitle: "服务条款",
        termsPageBody:
            "当前部署暂不提供独立的法律条文页面。请向管理员或 Pulse 法务联系人索取适用于您工作区的条款与可接受使用政策。"
    },
    commandPalette: {
        title: "命令面板",
        kindLabels: {
            project: "项目",
            task: "任务",
            column: "列",
            member: "成员"
        },
        kindTags: {
            project: "项目",
            task: "任务",
            column: "列",
            member: "成员"
        },
        sublabelColumn: "列",
        navigateInstructions: "搜索并跳转。在查询前加“/”切换到看板 Copilot。",
        copilotPromptHint: "输入您的问题,然后按回车键。",
        noResultsCopilotCta: "尝试询问看板 Copilot →",
        sampleAi: [
            "这个看板有哪些风险?",
            "总结一下这个看板",
            "谁未完成的工作最多?"
        ]
    },
    brief: {
        title: "看板 Copilot 简报",
        headline: "看板上共有 {total} 个任务，其中 {inProgress} 个正在进行中。",
        recommendedNextStep: "推荐的下一步",
        summaryTitle: "概览",
        summaryTotalTasks: "任务总数",
        summaryColumns: "列数",
        summaryUnowned: "无负责人",
        summaryContributors: "参与成员",
        countsPerColumn: "各列任务数",
        countsBarAria: "{column}：{count} 个任务",
        largestUnstarted: "未启动的最大任务",
        unownedTasks: "无负责人的任务",
        workload: "工作负载",
        noUnstarted: "没有未启动的任务,很棒。",
        allOwned: "所有任务都已分配负责人。",
        noActivePerMember: "成员暂无进行中的任务。",
        boardEmpty: "看板为空 — 先创建一项任务吧。",
        unstartedWaiting: "{count} 项未启动的任务等待认领。",
        overloaded: "{name} 当前负责 {count} 项进行中任务,可考虑重新分配。",
        unownedHeadline: "{count} 项任务尚无负责人。",
        column: "列",
        tasks: "任务数",
        basisLabel: "依据:{text}",
        basisItalic: "_依据:{text}_",
        openCount: "{count} 项进行中",
        ptsCount: "{count} 故事点",
        generated: "生成于{time}",
        relativeJustNow: "刚刚",
        relativeOneMinute: "1 分钟前",
        relativeMinutes: "{count} 分钟前",
        relativeOneHour: "1 小时前",
        relativeHours: "{count} 小时前",
        relativeOneDay: "1 天前",
        relativeDays: "{count} 天前",
        balancedRecommendation:
            "看板状态较均衡。请从待办列表顶部挑选下一个任务。",
        noIssuesBasis: "未检测到失衡、超大任务或无人负责的任务。",
        assignUnownedRecommendation:
            "在开始新工作前,先为 {count} 个无人负责的任务指定协调人。",
        unownedBasis: "此看板上共统计到 {count} 个没有协调人的任务。",
        largeTaskRecommendation:
            "“{name}” 体量较大（{points} 点）。建议先拆分。",
        largeTaskBasis: "最大的未启动任务为 {points} 个故事点。",
        rebalanceRecommendation:
            "{top} 当前承担了 {points} 点工作；可考虑向 {bottom} 重新分配。",
        rebalanceBasis:
            "{top} 当前有 {topPoints} 个进行中的点数，而 {bottom} 为 {bottomPoints} —— 至少存在 2:1 的失衡。",
        strengthLabels: {
            strong: "强信号",
            moderate: "中等信号",
            low: "弱信号 — 请审核",
            none: "无需操作"
        },
        strengthTooltips: {
            strong: "多个看板信号支持此建议,可放心采纳。",
            moderate: "有一两个看板信号支持此建议,采纳前请先浏览依据。",
            low: "信号较弱,采纳前请仔细审核依据。",
            none: "未检测到失衡,本建议仅供参考。"
        },
        markdownCountsHeading: "各列任务数",
        markdownLargestHeading: "未启动的最大任务",
        markdownUnownedHeading: "无负责人",
        markdownWorkloadHeading: "工作负载",
        markdownStoryPoints: "{count} 故事点",
        markdownWorkloadEntry: "{count} 项进行中 / {points} 故事点"
    },
    about: {
        title: "关于看板 Copilot",
        canHelpTitle: "看板 Copilot 可以帮助您做什么",
        canHelpItems: [
            "搜索并筛选任务",
            "总结看板状态",
            "起草新任务",
            "估算任务工作量",
            "回答有关您项目的问题"
        ],
        limitationsTitle: "它无法做到什么",
        limitationsItems: [
            "访问互联网或外部数据",
            "在未经您审核的情况下修改任务（计划模式下）",
            "记住之前会话中的对话"
        ],
        remoteModeTag: "远程模型",
        localModeTag: "本地引擎",
        remoteModeDescription:
            "由远程 AI 模型提供支持。您的数据会按照您的隐私设置进行处理。",
        localModeDescription: "运行在本地 AI 引擎上。您的数据保留在此设备上。",
        knowledgeCutoffTemplate: "知识截止时间：{date}",
        serverLimitsTitle: "服务器公布的限制",
        serverMetadataLoading: "正在加载服务器信息…",
        serverMetadataUnavailable: "无法加载服务器限制信息。",
        rateLimitLine: "速率限制：{perMinute} / 分钟 · {perHour} / 小时",
        monthlyBudgetCapLine: "组织每月 token 预算上限：{cap}（按项目预留）",
        allowedAutonomyLabel: "允许的自主级别",
        recursionLimitLine: "递归上限：{limit}",
        contextSchemaKeysLine: "上下文结构键：{keys}"
    },
    mutation: {
        riskHigh: "高风险",
        riskMedium: "中等风险",
        riskLow: "低风险",
        undoable: "可撤销",
        undoLabel: "撤销",
        undoApplied: "已撤销",
        undoAriaLabel: "撤销此提议",
        copilotProposes: "Copilot 提议:{description}",
        acceptingWillChange: "接受后将更改：{fields}",
        acceptingProposal: "正在接受此提议…",
        applyToast: "Copilot 已应用看板更改。",
        undoCountdownAria: "撤销 — 剩余 {seconds} 秒",
        undoCountdown: "撤销（{seconds} 秒）",
        undoAvailableAfterAccepting: "接受后有 10 秒可撤销",
        fields: {
            coordinator: "协调人",
            column: "列",
            epic: "史诗",
            type: "类型",
            storyPoints: "故事点",
            taskName: "任务名称",
            note: "备注"
        },
        diffColumns: {
            field: "字段",
            current: "当前值",
            proposed: "建议值"
        },
        columnFieldLabel: "列{field}",
        applyVerbs: {
            create: "创建",
            update: "保存更改",
            delete: "删除",
            move: "移动",
            reassign: "重新分配",
            renameColumn: "重命名"
        }
    },
    share: {
        headline: "分享到 Pulse",
        summary: "根据您分享的内容创建任务。",
        summaryTitle: "标题",
        summaryText: "文本",
        summaryUrl: "链接",
        projectLabel: "项目",
        columnLabel: "列",
        emptyTitle: "请先创建您的第一个项目,以便开始分享内容",
        emptyDescription: "Pulse 需要至少一个项目才能将分享内容收入其中。",
        nothingTitle: "暂无分享内容",
        nothingDescription:
            "请通过其他应用的分享面板打开 Pulse,以便在此处预填任务。"
    },
    swUpdate: {
        title: "新版本可用",
        description: "Pulse 已发布新版本。刷新页面即可获得最新的修复。",
        reload: "刷新",
        dismiss: "稍后",
        ariaLabel: "新版本可用通知"
    },
    pullToRefresh: {
        pull: "下拉刷新",
        release: "松开刷新",
        refreshing: "正在刷新…"
    },
    swipeActions: {
        favorite: "收藏",
        unfavorite: "取消收藏"
    },
    onboardingTour: {
        next: "下一步",
        previous: "上一步",
        done: "完成",
        skip: "跳过引导",
        welcome: {
            title: "欢迎使用 Pulse",
            description:
                "这是核心功能的快速引导。你可以随时跳过——它只会显示一次。"
        },
        navigation: {
            title: "了解导航",
            description: "随时从这里在看板、收件箱和 Copilot 之间切换。"
        },
        copilot: {
            title: "认识 Board Copilot",
            description:
                "Board Copilot 可以起草任务、拆解工作，并回答关于看板的问题。你可以随时开启或关闭。"
        },
        account: {
            title: "你的账户与设置",
            description: "从账户菜单切换主题、更改语言并退出登录。"
        }
    }
};

export default zhCN;
