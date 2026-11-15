import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Windows quirk: the same folder can be reached as `d:\app` or `D:\app`. Shells such as Git Bash
// and cmd (and some VS Code terminals) start in the lowercase form, so Vitest's worker is loaded
// from `d:\...` while a test file's `import "vitest"` resolves to the real-path `D:\...`. That is two
// copies of Vitest, and every test file then fails with "Vitest failed to find the runner".
// Pointing the bare `vitest` import at a path built from the shell's own working directory keeps
// both sides on one copy. On other platforms this resolves to the same file as the default.
const vitestEntry = path.join(process.cwd(), "node_modules", "vitest", "dist", "index.js");

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Vite resolves the `@/*` paths from tsconfig.json natively, so the
    // `vite-tsconfig-paths` plugin the Next.js guide mentions is not needed.
    tsconfigPaths: true,
    alias: [
      { find: /^vitest$/, replacement: vitestEntry },
      {
        // `server-only` throws when imported outside a React Server environment.
        // Under test the server modules are plain Node code, so it becomes a no-op.
        find: /^server-only$/,
        replacement: fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      },
    ],
  },
  test: {
    // Pure engine and API tests run in Node. A component test opts into jsdom
    // with a file-level `// @vitest-environment jsdom` comment.
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/api/**/*.test.{ts,tsx}"],
  },
});
