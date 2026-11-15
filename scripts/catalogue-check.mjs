// Lists catalogue titles that have already been released but still carry
// placeholder data: a `dataPending` flag, or episode titles of the form
// "Episode N" (the fallback `series()` uses when no real titles were supplied).
//
//   npm run catalogue:check              print the report, always exit 0
//   npm run catalogue:check -- --strict  exit 1 when anything is reported
//
// The catalogue is TypeScript, so it is loaded through Vite's module runner
// (Vite is installed as a dependency of Vitest). That keeps this script working
// when `src/lib/content.ts` becomes a barrel with extensionless imports.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const PLACEHOLDER_EPISODE = /^Episode \d+$/;

const { module: content } = await runnerImport(path.join(root, "src/lib/content.ts"), {
  root,
  configFile: false,
  logLevel: "error",
});

// Compare calendar dates in UTC, the same way the release lock will (see 1.3).
const today = new Date().toISOString().slice(0, 10);

const findings = [];
for (const item of content.CONTENT) {
  if (item.releaseDate > today) continue;
  const reasons = [];
  if (item.dataPending) reasons.push("dataPending");
  const placeholders = (item.episodes ?? []).filter((episode) => PLACEHOLDER_EPISODE.test(episode.title)).length;
  if (placeholders > 0) reasons.push(`${placeholders}/${item.episodes.length} placeholder episode titles`);
  if (reasons.length) findings.push({ id: item.id, title: item.title, releaseDate: item.releaseDate, reasons });
}

findings.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));

if (findings.length === 0) {
  console.log(`Catalogue check (${today}): every released title has real data.`);
} else {
  console.log(`Catalogue check (${today}): ${findings.length} released title${findings.length === 1 ? "" : "s"} still carry placeholder data.\n`);
  const idWidth = Math.max(...findings.map((finding) => finding.id.length));
  for (const finding of findings) {
    console.log(`  ${finding.id.padEnd(idWidth)}  ${finding.releaseDate}  ${finding.reasons.join("; ")}`);
  }
}

if (strict && findings.length > 0) process.exitCode = 1;
