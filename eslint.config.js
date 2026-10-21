const { defineConfig } = require("eslint/config");
const i18next = require("eslint-plugin-i18next");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([expoConfig, { ignores: ["dist/*", ".expo/*", ".claude/*"] },
  {
    // Copy goes through i18n keys (docs/i18n.md). A warning until step 3 of docs/i18n-plan.md makes it an error.
    files: ["app/**/*.{ts,tsx}", "src/screens/**/*.{ts,tsx}", "src/ui/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    plugins: { i18next },
    rules: { "i18next/no-literal-string": ["warn", { mode: "jsx-text-only" }] },
  },
]);
