/**
 * Invariants of the content catalogue (src/lib/catalogue). These are data-quality
 * checks: they fail when someone adds a title with a typo, an unsorted date or no art.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTENT,
  CONTENT_BY_ID,
  UNIVERSE_CONTENT,
  getPrerequisiteChain,
  type ContentItem,
  type Universe,
} from "@/lib/content";
import { directPrerequisites } from "@/lib/engine/graph";
import { backdropUrl, posterUrl } from "@/lib/media";

const PUBLIC_DIR = path.join(process.cwd(), "public");

/**
 * Titles that are allowed to ship without bundled art. Add an id here only when the
 * art genuinely does not exist yet (Avengers: Doomsday gets generated placeholder
 * art in package 3.1; until then it is not in the catalogue at all).
 */
const PLACEHOLDER_ART_ALLOW_LIST: ReadonlySet<string> = new Set<string>();

/**
 * A literal copy of the Street-Level prerequisites from before package 1.2 (the private
 * `STREET_PREREQUISITE_IDS` table in content.ts, plus the hard-coded rule that Hawkeye
 * needs Endgame). Since 1.2 they are the `requires` fields in `src/lib/catalogue/street.ts`;
 * this copy pins them, so changing a Street gate means changing this table on purpose.
 */
const STREET_DIRECT_PREREQUISITES: Record<string, string[]> = {
  "defenders-daredevil-1": [],
  "defenders-jessica-jones-1": [],
  "defenders-daredevil-2": ["defenders-daredevil-1"],
  "defenders-luke-cage-1": [],
  "defenders-iron-fist-1": [],
  "defenders-the-defenders": [
    "defenders-daredevil-1",
    "defenders-daredevil-2",
    "defenders-jessica-jones-1",
    "defenders-luke-cage-1",
    "defenders-iron-fist-1",
  ],
  "defenders-punisher-1": ["defenders-daredevil-2"],
  "defenders-jessica-jones-2": ["defenders-jessica-jones-1", "defenders-the-defenders"],
  "defenders-luke-cage-2": ["defenders-luke-cage-1", "defenders-the-defenders"],
  "defenders-iron-fist-2": ["defenders-iron-fist-1", "defenders-the-defenders"],
  "defenders-daredevil-3": ["defenders-daredevil-2", "defenders-the-defenders"],
  "defenders-punisher-2": ["defenders-punisher-1"],
  "defenders-jessica-jones-3": ["defenders-jessica-jones-2", "defenders-the-defenders"],
  hawkeye: ["endgame"],
  echo: ["hawkeye"],
  "born-again-1": ["defenders-daredevil-3"],
  "born-again-2": ["born-again-1"],
  "punisher-one-last-kill": ["defenders-punisher-2"],
};

const series = CONTENT.filter((item) => item.kind === "series");

describe("ids", () => {
  it("are unique across the whole catalogue", () => {
    const seen = new Set<string>();
    const duplicates = CONTENT.map((item) => item.id).filter((id) => {
      const duplicate = seen.has(id);
      seen.add(id);
      return duplicate;
    });
    expect(duplicates).toEqual([]);
  });

  it("are lowercase kebab-case, because they are database keys and file names", () => {
    const malformed = CONTENT.map((item) => item.id).filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id));
    expect(malformed).toEqual([]);
  });

  it("are indexed in CONTENT_BY_ID", () => {
    expect(CONTENT_BY_ID.size).toBe(CONTENT.length);
  });
});

describe("prerequisites", () => {
  const streetItems = UNIVERSE_CONTENT.street;

  it("have an explicit entry for every Street title and no extras", () => {
    // Street is the only universe with an explicit policy; every other title is chain-based.
    expect(streetItems.map((item) => item.id).sort()).toEqual(Object.keys(STREET_DIRECT_PREREQUISITES).sort());
  });

  it("are declared on every Street title as `requires`, matching the pinned table", () => {
    for (const item of streetItems) {
      expect(item.requires, item.id).toEqual(STREET_DIRECT_PREREQUISITES[item.id]);
      expect(item.alsoRequires, item.id).toBeUndefined();
    }
  });

  it("only reference ids that exist (every `requires` and `alsoRequires` entry)", () => {
    const unknown = CONTENT.flatMap((item) =>
      [...(item.requires ?? []), ...(item.alsoRequires ?? [])]
        .filter((candidate) => !CONTENT_BY_ID.has(candidate))
        .map((candidate) => `${item.id} -> ${candidate}`),
    );
    expect(unknown).toEqual([]);
  });

  it("are what the graph uses as the direct prerequisites of Street titles", () => {
    for (const item of streetItems) {
      expect(directPrerequisites(item.id), item.id).toEqual(STREET_DIRECT_PREREQUISITES[item.id]);
    }
  });

  it("are all part of each title's full prerequisite chain", () => {
    for (const [id, requires] of Object.entries(STREET_DIRECT_PREREQUISITES)) {
      const chain = getPrerequisiteChain(CONTENT_BY_ID.get(id)!).map((step) => step.id);
      for (const prerequisite of requires) expect(chain, `${id} needs ${prerequisite}`).toContain(prerequisite);
    }
  });

  it("never include a title that releases after the one that needs it", () => {
    for (const item of CONTENT) {
      for (const prerequisite of getPrerequisiteChain(item)) {
        expect(
          prerequisite.releaseDate <= item.releaseDate,
          `${prerequisite.id} (${prerequisite.releaseDate}) is a prerequisite of ${item.id} (${item.releaseDate})`,
        ).toBe(true);
      }
    }
  });

  it("never include the title itself except as the last step of its own chain", () => {
    for (const item of CONTENT) {
      const ids = getPrerequisiteChain(item).map((step) => step.id);
      expect(ids.at(-1), item.id).toBe(item.id);
      expect(new Set(ids).size, `${item.id} chain has a repeated title`).toBe(ids.length);
    }
  });

  it("never require a series whose episode list is still unknown", () => {
    const pendingButRequired = series.filter((item) => item.required && item.dataPending).map((item) => item.id);
    expect(pendingButRequired).toEqual([]);
  });
});

describe("release order", () => {
  for (const universe of Object.keys(UNIVERSE_CONTENT) as Universe[]) {
    it(`${universe} list is sorted by releaseDate`, () => {
      const list = UNIVERSE_CONTENT[universe];
      const outOfOrder = list.flatMap((item, index) =>
        index > 0 && list[index - 1].releaseDate > item.releaseDate
          ? [`${list[index - 1].id} (${list[index - 1].releaseDate}) is listed before ${item.id} (${item.releaseDate})`]
          : [],
      );
      expect(outOfOrder).toEqual([]);
    });
  }

  it("every title is in the list for its own universe", () => {
    for (const item of CONTENT) {
      expect(UNIVERSE_CONTENT[item.universe], item.id).toContain(item);
    }
  });

  it("release dates are real YYYY-MM-DD calendar dates and match the year field", () => {
    for (const item of CONTENT) {
      expect(item.releaseDate, item.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const parsed = new Date(`${item.releaseDate}T00:00:00Z`);
      expect(parsed.toISOString().slice(0, 10), `${item.id} has an impossible date`).toBe(item.releaseDate);
      expect(item.year, item.id).toBe(Number(item.releaseDate.slice(0, 4)));
    }
  });
});

describe("series", () => {
  it("have exactly one titled episode per episode number, numbered 1..n", () => {
    for (const item of series) {
      const episodes = item.episodes ?? [];
      expect(episodes.length, `${item.id} has no episodes`).toBeGreaterThan(0);
      expect(
        episodes.map((episode) => episode.id),
        `${item.id} episode numbers`,
      ).toEqual(episodes.map((_, index) => index + 1));
      for (const episode of episodes) {
        expect(episode.title.trim().length, `${item.id} episode ${episode.id} has an empty title`).toBeGreaterThan(0);
      }
    }
  });

  it("add up: the series runtime is the sum of its episode runtimes", () => {
    for (const item of series) {
      const total = (item.episodes ?? []).reduce((sum, episode) => sum + episode.runtimeSec, 0);
      expect(item.runtimeSec, item.id).toBe(total);
    }
  });

  it("have a known runtime for every episode unless the series is flagged dataPending", () => {
    for (const item of series.filter((candidate) => !candidate.dataPending)) {
      for (const episode of item.episodes ?? []) {
        expect(episode.runtimeSec, `${item.id} episode ${episode.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("only use the episodes field on series", () => {
    const stray = CONTENT.filter((item) => item.kind !== "series" && item.episodes !== undefined).map((item) => item.id);
    expect(stray).toEqual([]);
  });
});

describe("movies and specials", () => {
  it("have a positive runtime", () => {
    const unknown = CONTENT.filter((item) => item.kind !== "series" && !(item.runtimeSec > 0)).map((item) => item.id);
    expect(unknown).toEqual([]);
  });
});

describe("bundled art", () => {
  const exists = (publicUrl: string) => existsSync(path.join(PUBLIC_DIR, publicUrl));
  const needsArt = (item: ContentItem) => !PLACEHOLDER_ART_ALLOW_LIST.has(item.id);

  it("every title has a poster in public/posters", () => {
    const missing = CONTENT.filter(needsArt).filter((item) => !exists(posterUrl(item))).map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it("every title has a backdrop in public/backdrops", () => {
    const missing = CONTENT.filter(needsArt).filter((item) => !exists(backdropUrl(item))).map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it("the placeholder allow-list only names real catalogue ids", () => {
    for (const id of PLACEHOLDER_ART_ALLOW_LIST) expect(CONTENT_BY_ID.has(id), id).toBe(true);
  });
});
