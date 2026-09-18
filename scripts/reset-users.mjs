import { createClient } from "@libsql/client";

const databaseUrl = process.env.TURSO_DATABASE_URL ?? "file:marvel-vault.db";
const db = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

try {
  const before = await db.execute("SELECT COUNT(*) AS count FROM users");
  const userCount = Number(before.rows[0]?.count ?? 0);

  await db.batch(
    [
      "DELETE FROM progress",
      "DELETE FROM sessions",
      "DELETE FROM users",
    ],
    "write",
  );

  const after = await db.execute(
    "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM progress) AS progress",
  );
  const counts = after.rows[0];

  console.log(`Reset complete: removed ${userCount} user profile${userCount === 1 ? "" : "s"} and all associated sessions/progress.`);
  console.log(`Current rows: users=${counts?.users ?? 0}, sessions=${counts?.sessions ?? 0}, progress=${counts?.progress ?? 0}.`);
  console.log("Schema, indexes, and the source-controlled movie/show catalogue were preserved.");
} finally {
  db.close();
}
