// Builders the universe files use to write catalogue entries compactly.
import type { ContentItem, Episode } from "./types";

export const minutes = (value: number) => value * 60;

export function episodes(
  runtimes: number[],
  titles: string[] = [],
): Episode[] {
  return runtimes.map((runtime, index) => ({
    id: index + 1,
    title: titles[index] ?? `Episode ${index + 1}`,
    runtimeSec: minutes(runtime),
  }));
}

export function movie(
  id: string,
  title: string,
  releaseDate: string,
  runtime: number,
  phase: string,
  wikiTitle = `${title} (film)`,
  summary = "A pivotal chapter in the Marvel Cinematic Universe.",
  lore = "Its release position preserves the intended character reveals, alliances, and post-credit continuity.",
): ContentItem {
  return {
    id,
    title,
    year: Number(releaseDate.slice(0, 4)),
    releaseDate,
    universe: "mcu",
    kind: "movie",
    required: true,
    runtimeSec: minutes(runtime),
    phase,
    wikiTitle,
    summary,
    lore,
  };
}

export function series(
  id: string,
  title: string,
  releaseDate: string,
  runtimes: number[],
  required: boolean,
  phase: string,
  options: Partial<ContentItem> & { episodeTitles?: string[] } = {},
): ContentItem {
  const episodeList = episodes(runtimes, options.episodeTitles);
  return {
    id,
    title,
    year: Number(releaseDate.slice(0, 4)),
    releaseDate,
    universe: options.universe ?? "mcu",
    kind: "series",
    required,
    runtimeSec: episodeList.reduce((total, episode) => total + episode.runtimeSec, 0),
    phase,
    wikiTitle: options.wikiTitle ?? `${title} (TV series)`,
    summary: options.summary ?? "A Marvel Studios series expanding the characters and consequences of the cinematic timeline.",
    lore: options.lore ?? "Placed by premiere date so its reveals land in the same order audiences originally encountered them.",
    episodes: episodeList,
    recommendation: options.recommendation,
    dataPending: options.dataPending,
    ...(options.requires !== undefined ? { requires: options.requires } : {}),
    ...(options.alsoRequires !== undefined ? { alsoRequires: options.alsoRequires } : {}),
  };
}

export function special(
  id: string,
  title: string,
  releaseDate: string,
  runtime: number,
  phase: string,
  wikiTitle = title,
  summary = "A self-contained Marvel Studios special presentation.",
): ContentItem {
  return {
    id,
    title,
    year: Number(releaseDate.slice(0, 4)),
    releaseDate,
    universe: "mcu",
    kind: "special",
    required: false,
    runtimeSec: minutes(runtime),
    phase,
    wikiTitle,
    summary,
    lore: "Optional side transmission: it enriches the universe but does not gate the primary road to Doomsday.",
  };
}
