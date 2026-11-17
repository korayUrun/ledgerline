// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Import boundaries from docs/SYSTEM.md §2. These rules are the second line of
// defense: pnpm already refuses imports a package does not declare, but a
// careless `pnpm add` would silently lift that guard. Lint fails loudly instead.
//
// Each rule is an allow-list written as a regex with a negative lookahead:
// "anything that is NOT one of these is an error". An allow-list stays correct
// when someone installs a new package; a deny-list would not.

const ENGINE_PURITY_MESSAGE =
  "settlement-engine is pure (SYSTEM.md §2): it may import only @ledgerline/schemas and relative files. No I/O, DB, network, clock or randomness.";

export default defineConfig([
  globalIgnores(["**/node_modules/", "**/dist/", "**/.turbo/", "**/coverage/", "**/.next/"]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Each file is type-checked with the tsconfig.json of its own package.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Plain JS config files are not part of any tsconfig, so skip type-aware rules there.
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // --- settlement-engine: pure money math -------------------------------------
  {
    files: ["packages/settlement-engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\.{1,2}/|@ledgerline/schemas$|vitest$)",
              message: ENGINE_PURITY_MESSAGE,
            },
          ],
        },
      ],
      // Globals that mean I/O, time or environment. `Date` covers both
      // `Date.now()` and `new Date()`: the engine must not know what time it is.
      "no-restricted-globals": [
        "error",
        ...["process", "Buffer", "fetch", "crypto", "setTimeout", "setInterval", "Date"].map(
          (name) => ({ name, message: ENGINE_PURITY_MESSAGE }),
        ),
        {
          name: "parseFloat",
          message: "Money is integer cents (CLAUDE.md). Never parse money as a float.",
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: ENGINE_PURITY_MESSAGE },
        {
          object: "Number",
          property: "parseFloat",
          message: "Money is integer cents (CLAUDE.md). Never parse money as a float.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message:
            "toFixed rounds floats for display; money rounding goes through the engine's roundHalfUp helper only (CLAUDE.md).",
        },
      ],
    },
  },

  // --- schemas: the leaf of the graph -----------------------------------------
  {
    files: ["packages/schemas/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@ledgerline/",
              message:
                "schemas is the leaf of the dependency graph: it imports no other workspace package.",
            },
          ],
        },
      ],
    },
  },

  // --- web and mcp: talk to the API over HTTP only ----------------------------
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/mcp/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@ledgerline/(?!schemas$)|^@prisma/",
              message:
                "web and mcp reach data only through the api over HTTP (SYSTEM.md §2). Business rules live in one place: apps/api.",
            },
          ],
        },
      ],
    },
  },

  // Must stay last: turns off every stylistic rule that Prettier owns.
  prettier,
]);
