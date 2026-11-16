// Catalogue types. Content ids are database keys: never rename one.
export type Universe = "mcu" | "xmen" | "street";
export type ContentKind = "movie" | "series" | "special";

export type Episode = {
  id: number;
  title: string;
  runtimeSec: number;
};

export type ContentItem = {
  id: string;
  title: string;
  year: number;
  releaseDate: string;
  universe: Universe;
  kind: ContentKind;
  required: boolean;
  runtimeSec: number;
  phase: string;
  wikiTitle: string;
  summary: string;
  lore: string;
  episodes?: Episode[];
  recommendation?: string;
  dataPending?: boolean;
  /**
   * Direct prerequisites that REPLACE the universe policy for this title (see
   * `src/lib/engine/graph.ts`). Street-Level titles must always set it; `[]` means none.
   */
  requires?: string[];
  /** Direct prerequisites ADDED after the universe policy's own list. */
  alsoRequires?: string[];
};
