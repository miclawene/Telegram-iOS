// Root ESLint config for the node/TS packages. ESLint 8 walks up from each
// package dir and finds this, so packages don't each need their own file.
// (apps/web uses `next lint` with its own .eslintrc.json.)
/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@workos/eslint-config"],
  ignorePatterns: ["apps/web/**", "**/dist/**", "**/.next/**", "**/node_modules/**"],
};
