const { defineConfig } = require("eslint/config");
const i18next = require("eslint-plugin-i18next");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([expoConfig, { ignores: ["dist/*", ".expo/*", ".claude/*"] },
  {
    // Copy goes through i18n keys (docs/i18n.md). Units and glossary names may stay literal.
    files: ["app/**/*.{ts,tsx}", "src/screens/**/*.{ts,tsx}", "src/ui/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*", "src/ui/kit/**", "src/ui/fixtures/**"],
    plugins: { i18next },
    rules: { "i18next/no-literal-string": ["error", { mode: "jsx-text-only", words: { exclude: ["^[0-9\\s.,:;!?+\\-/%•·…()#*=<>|\\u00a0\\u2212]+$", "h", "min", "ms", "bpm", "rpm", "km", "mi", "kcal", "kg", "lb", "Pulse", "Pulse AB"] } }] },
  },
]);
