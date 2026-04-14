import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },

  // Type-checked strict + stylistic rules, scoped to package source files
  {
    files: ["packages/*/src/**/*.ts", "packages/*/src/**/*.tsx"],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // -- Strictness overrides (keep it reasonable, not pedantic) --

      // Allow underscore-prefixed unused vars (common for destructuring rest, callbacks)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Warn on explicit any — encourages fixing but doesn't block PRs
      "@typescript-eslint/no-explicit-any": "warn",

      // Allow numbers and booleans in template literals (common and safe)
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],

      // Allow void returns in arrow shorthand (e.g. onClick={() => doStuff())
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],

      // Require consistent type imports/exports for cleaner output and faster builds
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/consistent-type-exports": [
        "error",
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],

      // Enforce exhaustive switch/case on union types (catches missed variants)
      "@typescript-eslint/switch-exhaustiveness-check": "error",

      // Prefer nullish coalescing (??) over logical or (||) for safety with falsy values
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: { string: true } },
      ],
    },
  },

  // Relax rules for test files — tests legitimately use patterns that are too strict for prod
  {
    files: ["packages/*/src/**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
);
