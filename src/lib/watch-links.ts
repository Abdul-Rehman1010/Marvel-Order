export type WatchLinkCatalogue = {
  links: Map<string, string>;
  issues: string[];
};

const APPROVED_WATCH_HOSTS = [
  "disneyplus.com",
  "netflix.com",
  "primevideo.com",
  "amazon.com",
  "tv.apple.com",
  "max.com",
  "hulu.com",
  "paramountplus.com",
  "peacocktv.com",
  "justwatch.com",
  "youtube.com",
  "youtu.be",
] as const;

export function normalizeWatchTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function parseCsvRows(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  return { rows, unterminatedQuote: quoted };
}

function approvedWatchUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname.toLocaleLowerCase();
    const approved = hostname;;
    return approved ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseWatchLinksCsv(source: string, catalogueTitles: string[]): WatchLinkCatalogue {
  const links = new Map<string, string>();
  const issues: string[] = [];
  const { rows, unterminatedQuote } = parseCsvRows(source.replace(/^\uFEFF/, ""));
  if (unterminatedQuote) issues.push("The CSV contains an unterminated quoted value.");
  if (!rows.length) return { links, issues: ["The CSV is empty. Add the title,url header before adding links."] };

  const headers = rows[0].map((value) => normalizeWatchTitle(value).replace(/[ _-]+/g, ""));
  const titleIndex = headers.findIndex((value) => ["title", "name", "moviename"].includes(value));
  const urlIndex = headers.findIndex((value) => ["url", "link", "watchurl"].includes(value));
  if (titleIndex < 0 || urlIndex < 0) {
    return { links, issues: ["CSV headers must include title and url columns."] };
  }

  const knownTitles = new Map(catalogueTitles.map((title) => [normalizeWatchTitle(title), title]));
  rows.slice(1).forEach((row, rowIndex) => {
    const line = rowIndex + 2;
    const suppliedTitle = row[titleIndex]?.trim() ?? "";
    const suppliedUrl = row[urlIndex]?.trim() ?? "";
    if (!suppliedTitle) {
      issues.push(`Row ${line}: movie or series title is missing.`);
      return;
    }

    const normalizedTitle = normalizeWatchTitle(suppliedTitle);
    const catalogueTitle = knownTitles.get(normalizedTitle);
    if (!catalogueTitle) {
      issues.push(`Row ${line}: “${suppliedTitle}” was not found in the Doom Flix catalogue.`);
      return;
    }
    if (!suppliedUrl) {
      issues.push(`Row ${line}: URL is missing for “${catalogueTitle}”.`);
      return;
    }
    const url = approvedWatchUrl(suppliedUrl);
    if (!url) {
      issues.push(`Row ${line}: “${catalogueTitle}” does not use a supported HTTPS watch provider.`);
      return;
    }
    if (links.has(normalizedTitle)) {
      issues.push(`Row ${line}: duplicate link for “${catalogueTitle}”.`);
      return;
    }
    links.set(normalizedTitle, url);
  });

  return { links, issues };
}
