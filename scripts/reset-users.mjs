import { createClient } from "@libsql/client";

const databaseUrl = process.env.TURSO_DATABASE_URL ?? "file:marvel-vault.db";
const db = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Every table that holds user data, children first. Add a table here whenever a migration adds
// one (see src/lib/migrations.ts). The schema does not rely on ON DELETE CASCADE.
// `rate_limits` holds sign-in and sign-up attempt counters keyed by username and IP.
const USER_TABLES = ["skips", "progress", "sessions", "rate_limits", "users"];

try {
  // A database that has not been opened by a newer build yet may lack the newer tables.
  const existing = await db.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${USER_TABLES.map(() => "?").join(", ")})`,
    USER_TABLES,
  );
  const present = new Set(existing.rows.map((row) => String(row.name)));
  const tables = USER_TABLES.filter((table) => present.has(table));

  const before = await db.execute("SELECT COUNT(*) AS count FROM users");
  const userCount = Number(before.rows[0]?.count ?? 0);

  await db.batch(tables.map((table) => `DELETE FROM ${table}`), "write");

  const counts = [];
  for (const table of [...tables].reverse()) {
    const result = await db.execute(`SELECT COUNT(*) AS count FROM ${table}`);
    counts.push(`${table}=${Number(result.rows[0]?.count ?? 0)}`);
  }

  console.log(`Reset complete: removed ${userCount} user profile${userCount === 1 ? "" : "s"} and all associated sessions, progress and skips.`);
  console.log(`Current rows: ${counts.join(", ")}.`);
  console.log("Schema, indexes, and the source-controlled movie/show catalogue were preserved.");
} finally {
  db.close();
}
