import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Runs once before the suite: creates the git-ignored `.tmp/` folder and removes any
 * database left by a previous run, so every run starts with no users and no progress.
 *
 * Only ever touches `.tmp/e2e.db*`. It never goes near `marvel-vault.db`.
 */
export default function globalSetup() {
  const tmpDir = path.resolve(process.cwd(), ".tmp");
  mkdirSync(path.join(tmpDir, "shots"), { recursive: true });

  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = path.join(tmpDir, `e2e.db${suffix}`);
    try {
      rmSync(file, { force: true });
    } catch (error) {
      throw new Error(
        `Could not delete ${file}: ${error instanceof Error ? error.message : String(error)}. ` +
          "A dev server from an earlier run may still be holding it open; stop that process and try again.",
      );
    }
  }
}
