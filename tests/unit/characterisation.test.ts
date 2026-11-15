/**
 * Characterisation tests: they pin what `src/lib/content.ts` does TODAY.
 *
 * Package 1.2 moves the catalogue and prerequisite rules into `src/lib/catalogue/*`
 * and `src/lib/engine/graph.ts` and requires these snapshots to stay BYTE-IDENTICAL.
 * Never regenerate them (`vitest -u`) to make a refactor pass: a changed line here
 * is a changed user-visible lock. If a snapshot has to change, that is a deliberate
 * rules change that belongs in its own package with its own explanation.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CONTENT,
  MCU_CONTENT,
  XMEN_CONTENT,
  STREET_CONTENT,
  getPrerequisiteChain,
  isUnlocked,
  missingPrerequisite,
  progressKey,
  type ContentItem,
} from "@/lib/content";

// `isUnlocked` also compares release dates with the clock. Pin it so the snapshots
// cannot change when a new title's release date passes. Nothing in the catalogue is
// unreleased on this date.
const PINNED_NOW = new Date("2026-11-15T12:00:00Z");

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PINNED_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

const byId = (id: string): ContentItem => {
  const item = CONTENT.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown catalogue id in test fixture: ${id}`);
  return item;
};

/** Every progress key that marks `items` fully watched (one per episode for a series). */
function watchedKeys(items: ContentItem[]) {
  return new Set(
    items.flatMap((item) =>
      item.kind === "series"
        ? (item.episodes ?? []).map((episode) => progressKey(item.id, episode.id))
        : [progressKey(item.id)],
    ),
  );
}

function throughInclusive(list: ContentItem[], id: string) {
  return list.slice(0, list.findIndex((item) => item.id === id) + 1);
}

/** One line per title: `id  unlocked|locked  missing=<earliest unmet prerequisite id|none>`. */
function lockReport(watched: Set<string>) {
  const idWidth = Math.max(...CONTENT.map((item) => item.id.length));
  return CONTENT.map((item) => {
    const missing = missingPrerequisite(item, watched);
    const state = isUnlocked(item, watched) ? "unlocked" : "locked  ";
    return `${item.id.padEnd(idWidth)}  ${state}  missing=${missing?.id ?? "none"}`;
  }).join("\n");
}

describe("catalogue size", () => {
  it("covers all 92 titles, so every snapshot below is complete", () => {
    expect(CONTENT).toHaveLength(92);
    expect(MCU_CONTENT.length + XMEN_CONTENT.length + STREET_CONTENT.length).toBe(92);
  });
});

describe("spot values quoted in NEXT_LEVEL_PLAN.md section 4.4", () => {
  // The plan quotes these as the counts the redesigned graph must reproduce. They are
  // asserted here against today's code, so a wrong number in the plan shows up now.
  const prerequisiteCount = (id: string) => getPrerequisiteChain(byId(id)).length - 1;
  const dependentCount = (id: string) =>
    CONTENT.filter((item) => item.id !== id && getPrerequisiteChain(item).some((step) => step.id === id)).length;

  it("prerequisite counts", () => {
    expect({
      endgame: prerequisiteCount("endgame"),
      "multiverse-of-madness": prerequisiteCount("multiverse-of-madness"),
      hawkeye: prerequisiteCount("hawkeye"),
      echo: prerequisiteCount("echo"),
      deadpool: prerequisiteCount("deadpool"),
      "deadpool-2": prerequisiteCount("deadpool-2"),
      logan: prerequisiteCount("logan"),
      "deadpool-wolverine": prerequisiteCount("deadpool-wolverine"),
      "born-again-1": prerequisiteCount("born-again-1"),
      visionquest: prerequisiteCount("visionquest"),
      "moon-knight": prerequisiteCount("moon-knight"),
    }).toEqual({
      endgame: 21,
      "multiverse-of-madness": 30,
      hawkeye: 22,
      echo: 23,
      deadpool: 1,
      "deadpool-2": 2,
      logan: 8,
      "deadpool-wolverine": 10,
      "born-again-1": 7,
      visionquest: 44,
      "moon-knight": 0,
    });
  });

  it("dependent counts", () => {
    expect({
      "iron-man": dependentCount("iron-man"),
      "xmen-2000": dependentCount("xmen-2000"),
      endgame: dependentCount("endgame"),
    }).toEqual({ "iron-man": 60, "xmen-2000": 41, endgame: 39 });
  });

  it("no optional title has dependents", () => {
    const optionalWithDependents = CONTENT.filter((item) => !item.required && dependentCount(item.id) > 0).map((item) => item.id);
    expect(optionalWithDependents).toEqual([]);
  });
});

describe("getPrerequisiteChain (ordered; the title itself is last)", () => {
  it("returns the same ordered chain for all 92 titles", () => {
    const report = CONTENT.map(
      (item) => `${item.id}: ${getPrerequisiteChain(item).map((step) => step.id).join(" > ")}`,
    ).join("\n");
    expect(report).toMatchInlineSnapshot(`
      "iron-man: iron-man
      incredible-hulk: iron-man > incredible-hulk
      iron-man-2: iron-man > incredible-hulk > iron-man-2
      thor: iron-man > incredible-hulk > iron-man-2 > thor
      captain-america-first-avenger: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger
      avengers: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers
      iron-man-3: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3
      thor-dark-world: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world
      winter-soldier: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier
      guardians-1: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1
      age-of-ultron: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron
      ant-man: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man
      civil-war: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war
      doctor-strange: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange
      guardians-2: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2
      spider-man-homecoming: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming
      thor-ragnarok: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok
      black-panther: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther
      infinity-war: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war
      ant-man-wasp: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp
      captain-marvel: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel
      endgame: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame
      far-from-home: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home
      wandavision: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision
      falcon-winter-soldier: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier
      loki-1: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1
      black-widow: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow
      what-if-1: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > what-if-1
      shang-chi: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi
      eternals: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > eternals
      no-way-home: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home
      moon-knight: moon-knight
      multiverse-of-madness: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness
      ms-marvel: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel
      love-and-thunder: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder
      i-am-groot-1: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > i-am-groot-1
      she-hulk: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > she-hulk
      werewolf-by-night: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > werewolf-by-night
      wakanda-forever: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever
      guardians-holiday: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > guardians-holiday
      quantumania: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania
      guardians-3: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3
      secret-invasion: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion
      i-am-groot-2: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > i-am-groot-2
      loki-2: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2
      the-marvels: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels
      what-if-2: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > what-if-2
      agatha: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha
      what-if-3: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > what-if-3
      friendly-spider-man-1: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > friendly-spider-man-1
      brave-new-world: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > brave-new-world
      thunderbolts: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > brave-new-world > thunderbolts
      ironheart: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > brave-new-world > thunderbolts > ironheart
      fantastic-four-first-steps: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > brave-new-world > thunderbolts > fantastic-four-first-steps
      eyes-of-wakanda: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > brave-new-world > thunderbolts > fantastic-four-first-steps > eyes-of-wakanda
      marvel-zombies: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > brave-new-world > thunderbolts > fantastic-four-first-steps > marvel-zombies
      wonder-man: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > brave-new-world > thunderbolts > fantastic-four-first-steps > wonder-man
      brand-new-day: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > brave-new-world > thunderbolts > fantastic-four-first-steps > brand-new-day
      visionquest: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > brave-new-world > thunderbolts > fantastic-four-first-steps > brand-new-day > visionquest
      friendly-spider-man-2: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > far-from-home > wandavision > falcon-winter-soldier > loki-1 > black-widow > shang-chi > no-way-home > xmen-2000 > multiverse-of-madness > ms-marvel > love-and-thunder > wakanda-forever > quantumania > guardians-3 > secret-invasion > loki-2 > the-marvels > agatha > brave-new-world > thunderbolts > fantastic-four-first-steps > brand-new-day > visionquest > friendly-spider-man-2
      xmen-2000: xmen-2000
      x2: xmen-2000 > x2
      last-stand: xmen-2000 > x2 > last-stand
      origins-wolverine: xmen-2000 > x2 > last-stand > origins-wolverine
      first-class: xmen-2000 > x2 > last-stand > origins-wolverine > first-class
      the-wolverine: xmen-2000 > x2 > last-stand > origins-wolverine > first-class > the-wolverine
      days-future-past: xmen-2000 > x2 > last-stand > origins-wolverine > first-class > the-wolverine > days-future-past
      deadpool: xmen-2000 > deadpool
      apocalypse: xmen-2000 > x2 > last-stand > origins-wolverine > first-class > the-wolverine > days-future-past > deadpool > apocalypse
      logan: xmen-2000 > x2 > last-stand > origins-wolverine > first-class > the-wolverine > days-future-past > deadpool > logan
      deadpool-2: xmen-2000 > deadpool > deadpool-2
      dark-phoenix: xmen-2000 > x2 > last-stand > origins-wolverine > first-class > the-wolverine > days-future-past > deadpool > logan > deadpool-2 > dark-phoenix
      new-mutants: xmen-2000 > x2 > last-stand > origins-wolverine > first-class > the-wolverine > days-future-past > deadpool > logan > deadpool-2 > new-mutants
      deadpool-wolverine: xmen-2000 > x2 > last-stand > origins-wolverine > first-class > the-wolverine > days-future-past > deadpool > logan > deadpool-2 > deadpool-wolverine
      defenders-daredevil-1: defenders-daredevil-1
      defenders-jessica-jones-1: defenders-jessica-jones-1
      defenders-daredevil-2: defenders-daredevil-1 > defenders-daredevil-2
      defenders-luke-cage-1: defenders-luke-cage-1
      defenders-iron-fist-1: defenders-iron-fist-1
      defenders-the-defenders: defenders-daredevil-1 > defenders-daredevil-2 > defenders-jessica-jones-1 > defenders-luke-cage-1 > defenders-iron-fist-1 > defenders-the-defenders
      defenders-punisher-1: defenders-daredevil-1 > defenders-daredevil-2 > defenders-punisher-1
      defenders-jessica-jones-2: defenders-jessica-jones-1 > defenders-daredevil-1 > defenders-daredevil-2 > defenders-luke-cage-1 > defenders-iron-fist-1 > defenders-the-defenders > defenders-jessica-jones-2
      defenders-luke-cage-2: defenders-luke-cage-1 > defenders-daredevil-1 > defenders-daredevil-2 > defenders-jessica-jones-1 > defenders-iron-fist-1 > defenders-the-defenders > defenders-luke-cage-2
      defenders-iron-fist-2: defenders-iron-fist-1 > defenders-daredevil-1 > defenders-daredevil-2 > defenders-jessica-jones-1 > defenders-luke-cage-1 > defenders-the-defenders > defenders-iron-fist-2
      defenders-daredevil-3: defenders-daredevil-1 > defenders-daredevil-2 > defenders-jessica-jones-1 > defenders-luke-cage-1 > defenders-iron-fist-1 > defenders-the-defenders > defenders-daredevil-3
      defenders-punisher-2: defenders-daredevil-1 > defenders-daredevil-2 > defenders-punisher-1 > defenders-punisher-2
      defenders-jessica-jones-3: defenders-jessica-jones-1 > defenders-daredevil-1 > defenders-daredevil-2 > defenders-luke-cage-1 > defenders-iron-fist-1 > defenders-the-defenders > defenders-jessica-jones-2 > defenders-jessica-jones-3
      hawkeye: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > hawkeye
      echo: iron-man > incredible-hulk > iron-man-2 > thor > captain-america-first-avenger > avengers > iron-man-3 > thor-dark-world > winter-soldier > guardians-1 > age-of-ultron > ant-man > civil-war > doctor-strange > guardians-2 > spider-man-homecoming > thor-ragnarok > black-panther > infinity-war > ant-man-wasp > captain-marvel > endgame > hawkeye > echo
      born-again-1: defenders-daredevil-1 > defenders-daredevil-2 > defenders-jessica-jones-1 > defenders-luke-cage-1 > defenders-iron-fist-1 > defenders-the-defenders > defenders-daredevil-3 > born-again-1
      born-again-2: defenders-daredevil-1 > defenders-daredevil-2 > defenders-jessica-jones-1 > defenders-luke-cage-1 > defenders-iron-fist-1 > defenders-the-defenders > defenders-daredevil-3 > born-again-1 > born-again-2
      punisher-one-last-kill: defenders-daredevil-1 > defenders-daredevil-2 > defenders-punisher-1 > defenders-punisher-2 > punisher-one-last-kill"
    `);
  });
});

describe("locks for fixed watched states", () => {
  it("empty account", () => {
    expect(lockReport(new Set())).toMatchInlineSnapshot(`
      "iron-man                       unlocked  missing=none
      incredible-hulk                locked    missing=iron-man
      iron-man-2                     locked    missing=iron-man
      thor                           locked    missing=iron-man
      captain-america-first-avenger  locked    missing=iron-man
      avengers                       locked    missing=iron-man
      iron-man-3                     locked    missing=iron-man
      thor-dark-world                locked    missing=iron-man
      winter-soldier                 locked    missing=iron-man
      guardians-1                    locked    missing=iron-man
      age-of-ultron                  locked    missing=iron-man
      ant-man                        locked    missing=iron-man
      civil-war                      locked    missing=iron-man
      doctor-strange                 locked    missing=iron-man
      guardians-2                    locked    missing=iron-man
      spider-man-homecoming          locked    missing=iron-man
      thor-ragnarok                  locked    missing=iron-man
      black-panther                  locked    missing=iron-man
      infinity-war                   locked    missing=iron-man
      ant-man-wasp                   locked    missing=iron-man
      captain-marvel                 locked    missing=iron-man
      endgame                        locked    missing=iron-man
      far-from-home                  locked    missing=iron-man
      wandavision                    locked    missing=iron-man
      falcon-winter-soldier          locked    missing=iron-man
      loki-1                         locked    missing=iron-man
      black-widow                    locked    missing=iron-man
      what-if-1                      locked    missing=iron-man
      shang-chi                      locked    missing=iron-man
      eternals                       locked    missing=iron-man
      no-way-home                    locked    missing=iron-man
      moon-knight                    unlocked  missing=none
      multiverse-of-madness          locked    missing=iron-man
      ms-marvel                      locked    missing=iron-man
      love-and-thunder               locked    missing=iron-man
      i-am-groot-1                   locked    missing=iron-man
      she-hulk                       locked    missing=iron-man
      werewolf-by-night              locked    missing=iron-man
      wakanda-forever                locked    missing=iron-man
      guardians-holiday              locked    missing=iron-man
      quantumania                    locked    missing=iron-man
      guardians-3                    locked    missing=iron-man
      secret-invasion                locked    missing=iron-man
      i-am-groot-2                   locked    missing=iron-man
      loki-2                         locked    missing=iron-man
      the-marvels                    locked    missing=iron-man
      what-if-2                      locked    missing=iron-man
      agatha                         locked    missing=iron-man
      what-if-3                      locked    missing=iron-man
      friendly-spider-man-1          locked    missing=iron-man
      brave-new-world                locked    missing=iron-man
      thunderbolts                   locked    missing=iron-man
      ironheart                      locked    missing=iron-man
      fantastic-four-first-steps     locked    missing=iron-man
      eyes-of-wakanda                locked    missing=iron-man
      marvel-zombies                 locked    missing=iron-man
      wonder-man                     locked    missing=iron-man
      brand-new-day                  locked    missing=iron-man
      visionquest                    locked    missing=iron-man
      friendly-spider-man-2          locked    missing=iron-man
      xmen-2000                      unlocked  missing=none
      x2                             locked    missing=xmen-2000
      last-stand                     locked    missing=xmen-2000
      origins-wolverine              locked    missing=xmen-2000
      first-class                    locked    missing=xmen-2000
      the-wolverine                  locked    missing=xmen-2000
      days-future-past               locked    missing=xmen-2000
      deadpool                       locked    missing=xmen-2000
      apocalypse                     locked    missing=xmen-2000
      logan                          locked    missing=xmen-2000
      deadpool-2                     locked    missing=xmen-2000
      dark-phoenix                   locked    missing=xmen-2000
      new-mutants                    locked    missing=xmen-2000
      deadpool-wolverine             locked    missing=xmen-2000
      defenders-daredevil-1          unlocked  missing=none
      defenders-jessica-jones-1      unlocked  missing=none
      defenders-daredevil-2          locked    missing=defenders-daredevil-1
      defenders-luke-cage-1          unlocked  missing=none
      defenders-iron-fist-1          unlocked  missing=none
      defenders-the-defenders        locked    missing=defenders-daredevil-1
      defenders-punisher-1           locked    missing=defenders-daredevil-1
      defenders-jessica-jones-2      locked    missing=defenders-jessica-jones-1
      defenders-luke-cage-2          locked    missing=defenders-luke-cage-1
      defenders-iron-fist-2          locked    missing=defenders-iron-fist-1
      defenders-daredevil-3          locked    missing=defenders-daredevil-1
      defenders-punisher-2           locked    missing=defenders-daredevil-1
      defenders-jessica-jones-3      locked    missing=defenders-jessica-jones-1
      hawkeye                        locked    missing=iron-man
      echo                           locked    missing=iron-man
      born-again-1                   locked    missing=defenders-daredevil-1
      born-again-2                   locked    missing=defenders-daredevil-1
      punisher-one-last-kill         locked    missing=defenders-daredevil-1"
    `);
  });

  it("Phase One complete", () => {
    const phaseOne = MCU_CONTENT.filter((item) => item.phase === "Phase One");
    expect(phaseOne.map((item) => item.id)).toEqual([
      "iron-man",
      "incredible-hulk",
      "iron-man-2",
      "thor",
      "captain-america-first-avenger",
      "avengers",
    ]);
    expect(lockReport(watchedKeys(phaseOne))).toMatchInlineSnapshot(`
      "iron-man                       unlocked  missing=none
      incredible-hulk                unlocked  missing=none
      iron-man-2                     unlocked  missing=none
      thor                           unlocked  missing=none
      captain-america-first-avenger  unlocked  missing=none
      avengers                       unlocked  missing=none
      iron-man-3                     unlocked  missing=none
      thor-dark-world                locked    missing=iron-man-3
      winter-soldier                 locked    missing=iron-man-3
      guardians-1                    locked    missing=iron-man-3
      age-of-ultron                  locked    missing=iron-man-3
      ant-man                        locked    missing=iron-man-3
      civil-war                      locked    missing=iron-man-3
      doctor-strange                 locked    missing=iron-man-3
      guardians-2                    locked    missing=iron-man-3
      spider-man-homecoming          locked    missing=iron-man-3
      thor-ragnarok                  locked    missing=iron-man-3
      black-panther                  locked    missing=iron-man-3
      infinity-war                   locked    missing=iron-man-3
      ant-man-wasp                   locked    missing=iron-man-3
      captain-marvel                 locked    missing=iron-man-3
      endgame                        locked    missing=iron-man-3
      far-from-home                  locked    missing=iron-man-3
      wandavision                    locked    missing=iron-man-3
      falcon-winter-soldier          locked    missing=iron-man-3
      loki-1                         locked    missing=iron-man-3
      black-widow                    locked    missing=iron-man-3
      what-if-1                      locked    missing=iron-man-3
      shang-chi                      locked    missing=iron-man-3
      eternals                       locked    missing=iron-man-3
      no-way-home                    locked    missing=iron-man-3
      moon-knight                    unlocked  missing=none
      multiverse-of-madness          locked    missing=iron-man-3
      ms-marvel                      locked    missing=iron-man-3
      love-and-thunder               locked    missing=iron-man-3
      i-am-groot-1                   locked    missing=iron-man-3
      she-hulk                       locked    missing=iron-man-3
      werewolf-by-night              locked    missing=iron-man-3
      wakanda-forever                locked    missing=iron-man-3
      guardians-holiday              locked    missing=iron-man-3
      quantumania                    locked    missing=iron-man-3
      guardians-3                    locked    missing=iron-man-3
      secret-invasion                locked    missing=iron-man-3
      i-am-groot-2                   locked    missing=iron-man-3
      loki-2                         locked    missing=iron-man-3
      the-marvels                    locked    missing=iron-man-3
      what-if-2                      locked    missing=iron-man-3
      agatha                         locked    missing=iron-man-3
      what-if-3                      locked    missing=iron-man-3
      friendly-spider-man-1          locked    missing=iron-man-3
      brave-new-world                locked    missing=iron-man-3
      thunderbolts                   locked    missing=iron-man-3
      ironheart                      locked    missing=iron-man-3
      fantastic-four-first-steps     locked    missing=iron-man-3
      eyes-of-wakanda                locked    missing=iron-man-3
      marvel-zombies                 locked    missing=iron-man-3
      wonder-man                     locked    missing=iron-man-3
      brand-new-day                  locked    missing=iron-man-3
      visionquest                    locked    missing=iron-man-3
      friendly-spider-man-2          locked    missing=iron-man-3
      xmen-2000                      unlocked  missing=none
      x2                             locked    missing=xmen-2000
      last-stand                     locked    missing=xmen-2000
      origins-wolverine              locked    missing=xmen-2000
      first-class                    locked    missing=xmen-2000
      the-wolverine                  locked    missing=xmen-2000
      days-future-past               locked    missing=xmen-2000
      deadpool                       locked    missing=xmen-2000
      apocalypse                     locked    missing=xmen-2000
      logan                          locked    missing=xmen-2000
      deadpool-2                     locked    missing=xmen-2000
      dark-phoenix                   locked    missing=xmen-2000
      new-mutants                    locked    missing=xmen-2000
      deadpool-wolverine             locked    missing=xmen-2000
      defenders-daredevil-1          unlocked  missing=none
      defenders-jessica-jones-1      unlocked  missing=none
      defenders-daredevil-2          locked    missing=defenders-daredevil-1
      defenders-luke-cage-1          unlocked  missing=none
      defenders-iron-fist-1          unlocked  missing=none
      defenders-the-defenders        locked    missing=defenders-daredevil-1
      defenders-punisher-1           locked    missing=defenders-daredevil-1
      defenders-jessica-jones-2      locked    missing=defenders-jessica-jones-1
      defenders-luke-cage-2          locked    missing=defenders-luke-cage-1
      defenders-iron-fist-2          locked    missing=defenders-iron-fist-1
      defenders-daredevil-3          locked    missing=defenders-daredevil-1
      defenders-punisher-2           locked    missing=defenders-daredevil-1
      defenders-jessica-jones-3      locked    missing=defenders-jessica-jones-1
      hawkeye                        locked    missing=iron-man-3
      echo                           locked    missing=iron-man-3
      born-again-1                   locked    missing=defenders-daredevil-1
      born-again-2                   locked    missing=defenders-daredevil-1
      punisher-one-last-kill         locked    missing=defenders-daredevil-1"
    `);
  });

  it("everything through Avengers: Endgame", () => {
    expect(lockReport(watchedKeys(throughInclusive(MCU_CONTENT, "endgame")))).toMatchInlineSnapshot(`
      "iron-man                       unlocked  missing=none
      incredible-hulk                unlocked  missing=none
      iron-man-2                     unlocked  missing=none
      thor                           unlocked  missing=none
      captain-america-first-avenger  unlocked  missing=none
      avengers                       unlocked  missing=none
      iron-man-3                     unlocked  missing=none
      thor-dark-world                unlocked  missing=none
      winter-soldier                 unlocked  missing=none
      guardians-1                    unlocked  missing=none
      age-of-ultron                  unlocked  missing=none
      ant-man                        unlocked  missing=none
      civil-war                      unlocked  missing=none
      doctor-strange                 unlocked  missing=none
      guardians-2                    unlocked  missing=none
      spider-man-homecoming          unlocked  missing=none
      thor-ragnarok                  unlocked  missing=none
      black-panther                  unlocked  missing=none
      infinity-war                   unlocked  missing=none
      ant-man-wasp                   unlocked  missing=none
      captain-marvel                 unlocked  missing=none
      endgame                        unlocked  missing=none
      far-from-home                  unlocked  missing=none
      wandavision                    locked    missing=far-from-home
      falcon-winter-soldier          locked    missing=far-from-home
      loki-1                         locked    missing=far-from-home
      black-widow                    locked    missing=far-from-home
      what-if-1                      locked    missing=far-from-home
      shang-chi                      locked    missing=far-from-home
      eternals                       locked    missing=far-from-home
      no-way-home                    locked    missing=far-from-home
      moon-knight                    unlocked  missing=none
      multiverse-of-madness          locked    missing=far-from-home
      ms-marvel                      locked    missing=far-from-home
      love-and-thunder               locked    missing=far-from-home
      i-am-groot-1                   locked    missing=far-from-home
      she-hulk                       locked    missing=far-from-home
      werewolf-by-night              locked    missing=far-from-home
      wakanda-forever                locked    missing=far-from-home
      guardians-holiday              locked    missing=far-from-home
      quantumania                    locked    missing=far-from-home
      guardians-3                    locked    missing=far-from-home
      secret-invasion                locked    missing=far-from-home
      i-am-groot-2                   locked    missing=far-from-home
      loki-2                         locked    missing=far-from-home
      the-marvels                    locked    missing=far-from-home
      what-if-2                      locked    missing=far-from-home
      agatha                         locked    missing=far-from-home
      what-if-3                      locked    missing=far-from-home
      friendly-spider-man-1          locked    missing=far-from-home
      brave-new-world                locked    missing=far-from-home
      thunderbolts                   locked    missing=far-from-home
      ironheart                      locked    missing=far-from-home
      fantastic-four-first-steps     locked    missing=far-from-home
      eyes-of-wakanda                locked    missing=far-from-home
      marvel-zombies                 locked    missing=far-from-home
      wonder-man                     locked    missing=far-from-home
      brand-new-day                  locked    missing=far-from-home
      visionquest                    locked    missing=far-from-home
      friendly-spider-man-2          locked    missing=far-from-home
      xmen-2000                      unlocked  missing=none
      x2                             locked    missing=xmen-2000
      last-stand                     locked    missing=xmen-2000
      origins-wolverine              locked    missing=xmen-2000
      first-class                    locked    missing=xmen-2000
      the-wolverine                  locked    missing=xmen-2000
      days-future-past               locked    missing=xmen-2000
      deadpool                       locked    missing=xmen-2000
      apocalypse                     locked    missing=xmen-2000
      logan                          locked    missing=xmen-2000
      deadpool-2                     locked    missing=xmen-2000
      dark-phoenix                   locked    missing=xmen-2000
      new-mutants                    locked    missing=xmen-2000
      deadpool-wolverine             locked    missing=xmen-2000
      defenders-daredevil-1          unlocked  missing=none
      defenders-jessica-jones-1      unlocked  missing=none
      defenders-daredevil-2          locked    missing=defenders-daredevil-1
      defenders-luke-cage-1          unlocked  missing=none
      defenders-iron-fist-1          unlocked  missing=none
      defenders-the-defenders        locked    missing=defenders-daredevil-1
      defenders-punisher-1           locked    missing=defenders-daredevil-1
      defenders-jessica-jones-2      locked    missing=defenders-jessica-jones-1
      defenders-luke-cage-2          locked    missing=defenders-luke-cage-1
      defenders-iron-fist-2          locked    missing=defenders-iron-fist-1
      defenders-daredevil-3          locked    missing=defenders-daredevil-1
      defenders-punisher-2           locked    missing=defenders-daredevil-1
      defenders-jessica-jones-3      locked    missing=defenders-jessica-jones-1
      hawkeye                        unlocked  missing=none
      echo                           locked    missing=hawkeye
      born-again-1                   locked    missing=defenders-daredevil-1
      born-again-2                   locked    missing=defenders-daredevil-1
      punisher-one-last-kill         locked    missing=defenders-daredevil-1"
    `);
  });

  it("X-Men (2000) only", () => {
    expect(lockReport(watchedKeys([byId("xmen-2000")]))).toMatchInlineSnapshot(`
      "iron-man                       unlocked  missing=none
      incredible-hulk                locked    missing=iron-man
      iron-man-2                     locked    missing=iron-man
      thor                           locked    missing=iron-man
      captain-america-first-avenger  locked    missing=iron-man
      avengers                       locked    missing=iron-man
      iron-man-3                     locked    missing=iron-man
      thor-dark-world                locked    missing=iron-man
      winter-soldier                 locked    missing=iron-man
      guardians-1                    locked    missing=iron-man
      age-of-ultron                  locked    missing=iron-man
      ant-man                        locked    missing=iron-man
      civil-war                      locked    missing=iron-man
      doctor-strange                 locked    missing=iron-man
      guardians-2                    locked    missing=iron-man
      spider-man-homecoming          locked    missing=iron-man
      thor-ragnarok                  locked    missing=iron-man
      black-panther                  locked    missing=iron-man
      infinity-war                   locked    missing=iron-man
      ant-man-wasp                   locked    missing=iron-man
      captain-marvel                 locked    missing=iron-man
      endgame                        locked    missing=iron-man
      far-from-home                  locked    missing=iron-man
      wandavision                    locked    missing=iron-man
      falcon-winter-soldier          locked    missing=iron-man
      loki-1                         locked    missing=iron-man
      black-widow                    locked    missing=iron-man
      what-if-1                      locked    missing=iron-man
      shang-chi                      locked    missing=iron-man
      eternals                       locked    missing=iron-man
      no-way-home                    locked    missing=iron-man
      moon-knight                    unlocked  missing=none
      multiverse-of-madness          locked    missing=iron-man
      ms-marvel                      locked    missing=iron-man
      love-and-thunder               locked    missing=iron-man
      i-am-groot-1                   locked    missing=iron-man
      she-hulk                       locked    missing=iron-man
      werewolf-by-night              locked    missing=iron-man
      wakanda-forever                locked    missing=iron-man
      guardians-holiday              locked    missing=iron-man
      quantumania                    locked    missing=iron-man
      guardians-3                    locked    missing=iron-man
      secret-invasion                locked    missing=iron-man
      i-am-groot-2                   locked    missing=iron-man
      loki-2                         locked    missing=iron-man
      the-marvels                    locked    missing=iron-man
      what-if-2                      locked    missing=iron-man
      agatha                         locked    missing=iron-man
      what-if-3                      locked    missing=iron-man
      friendly-spider-man-1          locked    missing=iron-man
      brave-new-world                locked    missing=iron-man
      thunderbolts                   locked    missing=iron-man
      ironheart                      locked    missing=iron-man
      fantastic-four-first-steps     locked    missing=iron-man
      eyes-of-wakanda                locked    missing=iron-man
      marvel-zombies                 locked    missing=iron-man
      wonder-man                     locked    missing=iron-man
      brand-new-day                  locked    missing=iron-man
      visionquest                    locked    missing=iron-man
      friendly-spider-man-2          locked    missing=iron-man
      xmen-2000                      unlocked  missing=none
      x2                             unlocked  missing=none
      last-stand                     locked    missing=x2
      origins-wolverine              locked    missing=x2
      first-class                    locked    missing=x2
      the-wolverine                  locked    missing=x2
      days-future-past               locked    missing=x2
      deadpool                       unlocked  missing=none
      apocalypse                     locked    missing=x2
      logan                          locked    missing=x2
      deadpool-2                     locked    missing=deadpool
      dark-phoenix                   locked    missing=x2
      new-mutants                    locked    missing=x2
      deadpool-wolverine             locked    missing=x2
      defenders-daredevil-1          unlocked  missing=none
      defenders-jessica-jones-1      unlocked  missing=none
      defenders-daredevil-2          locked    missing=defenders-daredevil-1
      defenders-luke-cage-1          unlocked  missing=none
      defenders-iron-fist-1          unlocked  missing=none
      defenders-the-defenders        locked    missing=defenders-daredevil-1
      defenders-punisher-1           locked    missing=defenders-daredevil-1
      defenders-jessica-jones-2      locked    missing=defenders-jessica-jones-1
      defenders-luke-cage-2          locked    missing=defenders-luke-cage-1
      defenders-iron-fist-2          locked    missing=defenders-iron-fist-1
      defenders-daredevil-3          locked    missing=defenders-daredevil-1
      defenders-punisher-2           locked    missing=defenders-daredevil-1
      defenders-jessica-jones-3      locked    missing=defenders-jessica-jones-1
      hawkeye                        locked    missing=iron-man
      echo                           locked    missing=iron-man
      born-again-1                   locked    missing=defenders-daredevil-1
      born-again-2                   locked    missing=defenders-daredevil-1
      punisher-one-last-kill         locked    missing=defenders-daredevil-1"
    `);
  });

  it("Daredevil Season 1 complete", () => {
    expect(lockReport(watchedKeys([byId("defenders-daredevil-1")]))).toMatchInlineSnapshot(`
      "iron-man                       unlocked  missing=none
      incredible-hulk                locked    missing=iron-man
      iron-man-2                     locked    missing=iron-man
      thor                           locked    missing=iron-man
      captain-america-first-avenger  locked    missing=iron-man
      avengers                       locked    missing=iron-man
      iron-man-3                     locked    missing=iron-man
      thor-dark-world                locked    missing=iron-man
      winter-soldier                 locked    missing=iron-man
      guardians-1                    locked    missing=iron-man
      age-of-ultron                  locked    missing=iron-man
      ant-man                        locked    missing=iron-man
      civil-war                      locked    missing=iron-man
      doctor-strange                 locked    missing=iron-man
      guardians-2                    locked    missing=iron-man
      spider-man-homecoming          locked    missing=iron-man
      thor-ragnarok                  locked    missing=iron-man
      black-panther                  locked    missing=iron-man
      infinity-war                   locked    missing=iron-man
      ant-man-wasp                   locked    missing=iron-man
      captain-marvel                 locked    missing=iron-man
      endgame                        locked    missing=iron-man
      far-from-home                  locked    missing=iron-man
      wandavision                    locked    missing=iron-man
      falcon-winter-soldier          locked    missing=iron-man
      loki-1                         locked    missing=iron-man
      black-widow                    locked    missing=iron-man
      what-if-1                      locked    missing=iron-man
      shang-chi                      locked    missing=iron-man
      eternals                       locked    missing=iron-man
      no-way-home                    locked    missing=iron-man
      moon-knight                    unlocked  missing=none
      multiverse-of-madness          locked    missing=iron-man
      ms-marvel                      locked    missing=iron-man
      love-and-thunder               locked    missing=iron-man
      i-am-groot-1                   locked    missing=iron-man
      she-hulk                       locked    missing=iron-man
      werewolf-by-night              locked    missing=iron-man
      wakanda-forever                locked    missing=iron-man
      guardians-holiday              locked    missing=iron-man
      quantumania                    locked    missing=iron-man
      guardians-3                    locked    missing=iron-man
      secret-invasion                locked    missing=iron-man
      i-am-groot-2                   locked    missing=iron-man
      loki-2                         locked    missing=iron-man
      the-marvels                    locked    missing=iron-man
      what-if-2                      locked    missing=iron-man
      agatha                         locked    missing=iron-man
      what-if-3                      locked    missing=iron-man
      friendly-spider-man-1          locked    missing=iron-man
      brave-new-world                locked    missing=iron-man
      thunderbolts                   locked    missing=iron-man
      ironheart                      locked    missing=iron-man
      fantastic-four-first-steps     locked    missing=iron-man
      eyes-of-wakanda                locked    missing=iron-man
      marvel-zombies                 locked    missing=iron-man
      wonder-man                     locked    missing=iron-man
      brand-new-day                  locked    missing=iron-man
      visionquest                    locked    missing=iron-man
      friendly-spider-man-2          locked    missing=iron-man
      xmen-2000                      unlocked  missing=none
      x2                             locked    missing=xmen-2000
      last-stand                     locked    missing=xmen-2000
      origins-wolverine              locked    missing=xmen-2000
      first-class                    locked    missing=xmen-2000
      the-wolverine                  locked    missing=xmen-2000
      days-future-past               locked    missing=xmen-2000
      deadpool                       locked    missing=xmen-2000
      apocalypse                     locked    missing=xmen-2000
      logan                          locked    missing=xmen-2000
      deadpool-2                     locked    missing=xmen-2000
      dark-phoenix                   locked    missing=xmen-2000
      new-mutants                    locked    missing=xmen-2000
      deadpool-wolverine             locked    missing=xmen-2000
      defenders-daredevil-1          unlocked  missing=none
      defenders-jessica-jones-1      unlocked  missing=none
      defenders-daredevil-2          unlocked  missing=none
      defenders-luke-cage-1          unlocked  missing=none
      defenders-iron-fist-1          unlocked  missing=none
      defenders-the-defenders        locked    missing=defenders-daredevil-2
      defenders-punisher-1           locked    missing=defenders-daredevil-2
      defenders-jessica-jones-2      locked    missing=defenders-jessica-jones-1
      defenders-luke-cage-2          locked    missing=defenders-luke-cage-1
      defenders-iron-fist-2          locked    missing=defenders-iron-fist-1
      defenders-daredevil-3          locked    missing=defenders-daredevil-2
      defenders-punisher-2           locked    missing=defenders-daredevil-2
      defenders-jessica-jones-3      locked    missing=defenders-jessica-jones-1
      hawkeye                        locked    missing=iron-man
      echo                           locked    missing=iron-man
      born-again-1                   locked    missing=defenders-daredevil-2
      born-again-2                   locked    missing=defenders-daredevil-2
      punisher-one-last-kill         locked    missing=defenders-daredevil-2"
    `);
  });
});
