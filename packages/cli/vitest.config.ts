import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
    // local-provider integration tests do real `git init` / `git commit` /
    // `git show` / `rg` work in a tmpdir per test, which can run long under
    // the default 5s when vitest workers contend on disk.
    testTimeout: 30_000,
  },
});
