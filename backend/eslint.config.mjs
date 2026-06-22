import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn", // you use `any` deliberately in a few spots, that's fine for now
    },
  },
  {
    ignores: ["dist/**", "node_modules/**"],
  }
);