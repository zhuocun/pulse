import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import prettierPlugin from "eslint-plugin-prettier";
import simpleImportSortPlugin from "eslint-plugin-simple-import-sort";

export default [
    {
        ignores: ["build/**", "coverage/**", "dist/**", "node_modules/**"],
        linterOptions: {
            reportUnusedDisableDirectives: false
        }
    },
    {
        files: ["**/*.{js,jsx,ts,tsx}"],
        languageOptions: {
            ecmaVersion: "latest",
            parser: tsParser,
            parserOptions: {
                ecmaFeatures: {
                    jsx: true
                },
                sourceType: "module"
            },
            sourceType: "module"
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            "jsx-a11y": jsxA11yPlugin,
            prettier: prettierPlugin,
            "simple-import-sort": simpleImportSortPlugin
        },
        rules: {
            ...js.configs.recommended.rules,
            ...tsPlugin.configs.recommended.rules,
            ...jsxA11yPlugin.configs.recommended.rules,
            // Allow text labels on link-variant custom buttons like
            // <NoPaddingButton variant="link">Logout</NoPaddingButton>, which
            // render to real <button> elements with accessible names.
            "jsx-a11y/anchor-is-valid": "off",
            "jsx-a11y/click-events-have-key-events": "warn",
            "jsx-a11y/no-static-element-interactions": "warn",
            "jsx-a11y/label-has-associated-control": "warn",
            "jsx-a11y/no-noninteractive-element-interactions": "warn",
            "jsx-a11y/no-autofocus": "off",
            "jsx-a11y/control-has-associated-label": "off",
            "@typescript-eslint/no-shadow": "error",
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_"
                }
            ],
            "@typescript-eslint/no-var-requires": "off",
            "no-console": "warn",
            "no-nested-ternary": "off",
            "no-param-reassign": [
                "error",
                {
                    props: false
                }
            ],
            "no-plusplus": "off",
            "no-restricted-exports": "off",
            // §3.1 of the UI/UX plan bans raw "Submit"/"OK"/"Login"/"Signup"
            // button labels and the TitleCase "Edit Task" / "Create Project"
            // strings in favour of the central `microcopy.actions.*` keys
            // (which carry sentence case and a locale-aware lookup). The
            // deleted `uiQuality.strict` / `uiCopyConsistency.strict` suites
            // policed these literals across the whole app via DOM scans; a
            // single `no-restricted-syntax` rule catches the same regression
            // at the source, cheaper and earlier. The selector targets
            // `<Button>…</Button>` children (the only place these literals
            // actually shipped to users) so unrelated DOM text like a test
            // fixture's `<span>OK</span>` keeps working.
            "no-restricted-syntax": [
                "error",
                {
                    selector:
                        "JSXElement[openingElement.name.name=/^(Button|button)$/] > JSXText[value=/^\\s*(Submit|OK|Login|Signup|Edit Task|Create Project)\\s*$/]",
                    message:
                        "Don't hard-code button labels like 'Submit' / 'OK' / 'Login' / 'Signup' / 'Edit Task' / 'Create Project'. Use a `microcopy.actions.*` key (e.g. `microcopy.actions.logIn`, `microcopy.actions.editTask`) so casing and locale stay centralised."
                },
                {
                    selector:
                        "JSXAttribute[name.name=/^(title|okText|cancelText|aria-label)$/] > Literal[value=/^(Submit|OK|Login|Signup|Edit Task|Create Project)$/]",
                    message:
                        "Don't hard-code dialog/button title strings like 'Submit' / 'OK' / 'Login' / 'Signup' / 'Edit Task' / 'Create Project'. Use a `microcopy.actions.*` key (e.g. `microcopy.actions.editTask`) so casing and locale stay centralised."
                }
            ],
            "no-shadow": "off",
            "no-undef": "off",
            "no-underscore-dangle": [
                "error",
                {
                    allow: ["_id", "__copilotObservabilityWarnings__"]
                }
            ],
            "no-unused-vars": "off",
            "no-use-before-define": ["error", "nofunc"],
            "prettier/prettier": "error",
            "simple-import-sort/exports": "error"
        }
    }
];
