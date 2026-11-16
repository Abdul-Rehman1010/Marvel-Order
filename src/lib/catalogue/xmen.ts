// Fox X-Men films, in release order. Policy: release chain (see engine/graph.ts).
import { minutes } from "./build";
import type { ContentItem } from "./types";

function xmenMovie(
  id: string,
  title: string,
  releaseDate: string,
  runtime: number,
  required = true,
  wikiTitle = `${title} (film)`,
  lore = "Preserves the release-order evolution of the Fox mutant continuity without forcing optional detours.",
): ContentItem {
  return {
    id,
    title,
    year: Number(releaseDate.slice(0, 4)),
    releaseDate,
    universe: "xmen",
    kind: "movie",
    required,
    runtimeSec: minutes(runtime),
    phase: "Fox Mutant Timeline",
    wikiTitle,
    summary: "A chapter of the legacy X-Men film universe that feeds the wider multiverse context.",
    lore,
  };
}

export const xmen: ContentItem[] = [
  xmenMovie("xmen-2000", "X-Men", "2000-07-14", 104, true, "X-Men (film)", "The essential mutant foundation: introduces Charles Xavier, Magneto, the X-Men, and the ideological conflict later echoed across the multiverse."),
  xmenMovie("x2", "X2: X-Men United", "2003-05-02", 134, true, "X2 (film)"),
  xmenMovie("last-stand", "X-Men: The Last Stand", "2006-05-26", 104, true, "X-Men: The Last Stand"),
  xmenMovie("origins-wolverine", "X-Men Origins: Wolverine", "2009-05-01", 107, true, "X-Men Origins: Wolverine"),
  xmenMovie("first-class", "X-Men: First Class", "2011-06-03", 132, true, "X-Men: First Class"),
  xmenMovie("the-wolverine", "The Wolverine", "2013-07-26", 126, true, "The Wolverine (film)"),
  xmenMovie("days-future-past", "X-Men: Days of Future Past", "2014-05-23", 132, true, "X-Men: Days of Future Past"),
  { ...xmenMovie("deadpool", "Deadpool", "2016-02-12", 108, true, "Deadpool (film)", "Requires X-Men (2000) to establish the legacy mutant universe before Wade Wilson's story begins."), requires: ["xmen-2000"] },
  xmenMovie("apocalypse", "X-Men: Apocalypse", "2016-05-27", 144, false, "X-Men: Apocalypse", "Optional branch: shown in release position but not required for the Doomsday-ready path."),
  xmenMovie("logan", "Logan", "2017-03-03", 137, true, "Logan (film)"),
  { ...xmenMovie("deadpool-2", "Deadpool 2", "2018-05-18", 119, true, "Deadpool 2", "Required for Doomsday, and requires only Deadpool so Wade Wilson's story and supporting characters carry forward in sequence."), requires: ["deadpool"] },
  xmenMovie("dark-phoenix", "Dark Phoenix", "2019-06-07", 114, false, "Dark Phoenix (film)", "Optional branch: visible for completionists but never blocks later required mutant entries."),
  xmenMovie("new-mutants", "The New Mutants", "2020-08-28", 94, false, "The New Mutants (film)", "Optional branch: part of the Fox catalogue, but not required for the core Doomsday context."),
  xmenMovie("deadpool-wolverine", "Deadpool & Wolverine", "2024-07-26", 128, true, "Deadpool & Wolverine", "Required for Doomsday. Its spoiler-safe gate: complete every earlier required mutant film, including Deadpool 2."),
];
