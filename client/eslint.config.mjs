// ESLint (flat config). `next/core-web-vitals` brings the Next.js rules plus
// react-hooks (rules-of-hooks, exhaustive-deps). On top, the import boundaries
// from the frontend-ui-architecture skill (§8):
//   - shared code (`src/components`, `src/lib`) never imports from `src/app`;
//   - a route never reaches into ANOTHER route's private `_components` —
//     promote the piece to `src/components/<kebab-name>/` first;
//   - anything outside the current component folder is imported via `@/`.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "src/vendor/**"] },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: ["./src/components", "./src/lib"],
              from: "./src/app",
              message:
                "Shared code must not depend on a route. Move the piece to src/components or src/lib (frontend-ui-architecture §8).",
            },
          ],
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../_components", "../_components/*", "../../**/_components/*"],
              message:
                "Cross-route import of another route's private _components. Promote it to src/components/<kebab-name>/ (frontend-ui-architecture §8).",
            },
            {
              group: ["../../../*"],
              message: "Use the @/ alias instead of a ../../../ chain (frontend-ui-architecture §8).",
            },
          ],
        },
      ],
    },
  },
];

export default config;
