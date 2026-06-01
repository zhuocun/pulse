export const styledClassFor = (element: Element): string | undefined =>
    element.className
        .split(/\s+/)
        .find(
            (token) =>
                /^css-[a-z0-9]{4,}$/i.test(token) &&
                !token.startsWith("css-var-") &&
                !token.startsWith("css-dev-only-")
        );

export const ruleTextsFor = (styledClass: string): string[] => {
    const ruleTexts: string[] = [];
    const visit = (rule: CSSRule) => {
        if (rule instanceof CSSStyleRule) {
            if (rule.selectorText.includes(styledClass)) {
                ruleTexts.push(rule.cssText);
            }
            return;
        }
        if ("cssRules" in rule) {
            for (const childRule of Array.from(
                (rule as CSSGroupingRule).cssRules
            )) {
                visit(childRule);
            }
        }
    };

    Array.from(document.styleSheets).forEach((sheet) => {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            return;
        }
        for (const rule of Array.from(rules)) visit(rule);
    });

    return ruleTexts;
};

export const mediaRuleTextsFor = (
    styledClass: string,
    conditionNeedle: string
): string[] => {
    const ruleTexts: string[] = [];
    const visit = (rule: CSSRule) => {
        if (rule instanceof CSSStyleRule) {
            const parent = rule.parentRule;
            const inMedia =
                parent instanceof CSSMediaRule &&
                parent.conditionText.includes(conditionNeedle);
            if (inMedia && rule.selectorText.includes(styledClass)) {
                ruleTexts.push(rule.cssText);
            }
            return;
        }
        if ("cssRules" in rule) {
            for (const childRule of Array.from(
                (rule as CSSGroupingRule).cssRules
            )) {
                visit(childRule);
            }
        }
    };

    Array.from(document.styleSheets).forEach((sheet) => {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            return;
        }
        for (const rule of Array.from(rules)) visit(rule);
    });

    return ruleTexts;
};

export const coarseTouchTargetsFor = (styledClass: string) => {
    const heights: number[] = [];
    const widths: number[] = [];
    const visit = (rule: CSSRule) => {
        if (rule instanceof CSSStyleRule) {
            const parent = rule.parentRule;
            const inCoarse =
                parent instanceof CSSMediaRule &&
                parent.conditionText.includes("coarse");
            if (!inCoarse || !rule.selectorText.includes(styledClass)) return;

            const heightMatch =
                /(?:^|[\s;{])(?:min-)?(?:block-size|height):\s*(\d+(?:\.\d+)?)px/i.exec(
                    rule.cssText
                );
            const widthMatch =
                /(?:^|[\s;{])(?:min-)?(?:inline-size|width):\s*(\d+(?:\.\d+)?)px/i.exec(
                    rule.cssText
                );
            if (heightMatch) heights.push(Number(heightMatch[1]));
            if (widthMatch) widths.push(Number(widthMatch[1]));
            return;
        }
        if ("cssRules" in rule) {
            for (const childRule of Array.from(
                (rule as CSSGroupingRule).cssRules
            )) {
                visit(childRule);
            }
        }
    };

    Array.from(document.styleSheets).forEach((sheet) => {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            return;
        }
        for (const rule of Array.from(rules)) visit(rule);
    });

    return { heights, widths };
};
