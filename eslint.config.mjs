import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/** Flat ESLint config: TypeScript-aware, no-unused-vars and no-explicit-any as the guard
 *  rails the spec asks for. Kept self-contained so `eslint .` is reproducible in CI. */
export default [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "*.config.mjs", "*.config.ts"] },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
    },
  },
];
