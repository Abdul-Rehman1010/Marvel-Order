/**
 * The content catalogue: every title, grouped by universe and in release order.
 *
 * Data only. Prerequisite rules live in `src/lib/engine/graph.ts`, which reads each title's
 * `requires` / `alsoRequires` fields together with its universe's policy.
 *
 * Imports in this folder are relative on purpose: `scripts/catalogue-check.mjs` loads the
 * catalogue without the app's `@/` path alias.
 */
import { mcu } from "./mcu";
import { street } from "./street";
import { MOVIE_SUMMARIES } from "./summaries";
import type { ContentItem, Universe } from "./types";
import { xmen } from "./xmen";

export type { ContentItem, ContentKind, Episode, Universe } from "./types";

for (const item of [...mcu, ...xmen, ...street]) {
  if (item.kind === "movie" && MOVIE_SUMMARIES[item.id]) {
    item.summary = MOVIE_SUMMARIES[item.id];
  }
}

export const CONTENT: ContentItem[] = [...mcu, ...xmen, ...street];
export const MCU_CONTENT = mcu;
export const XMEN_CONTENT = xmen;
export const STREET_CONTENT = street;
export const UNIVERSE_CONTENT: Record<Universe, ContentItem[]> = {
  mcu: MCU_CONTENT,
  xmen: XMEN_CONTENT,
  street: STREET_CONTENT,
};

export const CONTENT_BY_ID = new Map(CONTENT.map((item) => [item.id, item]));
