import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      // Exclude generated Prisma client from linting
      "node_modules/.prisma/**/*",
      "node_modules/@prisma/client/**/*",
      // Exclude other build artifacts
      ".next/**/*",
      "out/**/*",
    ],
  },
];

export default eslintConfig;
