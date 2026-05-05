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
            // Allow text labels on AntD-styled custom components like
            // <NoPaddingButton type="link">Logout</NoPaddingButton>; AntD
            // renders these to real <button> elements with accessible names.
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
