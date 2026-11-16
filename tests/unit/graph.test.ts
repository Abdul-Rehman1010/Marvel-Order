/**
 * The prerequisite graph (src/lib/engine/graph.ts, NEXT_LEVEL_PLAN.md §4.4 and §4.7 "Graph").
 *
 * The first block builds small made-up catalogues to prove that building refuses broken data
 * (cycles, unknown ids and the rest). The second block checks the real catalogue. The ordered
 * chains themselves are pinned by the snapshots in characterisation.test.ts.
 */
import { describe, expect, it } from "vitest";

import { CONTENT, CONTENT_BY_ID, getPrerequisiteChain, missingPrerequisite, type ContentItem, type Universe } from "@/lib/content";
import {
  buildGraph,
  dependents,
  directPrerequisites,
  prerequisiteChain,
  reducedEdges,
  type PrerequisiteGraph,
} from "@/lib/engine/graph";

/** A minimal made-up title. Only the fields the graph reads matter. */
function title(id: string, universe: Universe, extra: Partial<ContentItem> = {}): ContentItem {
  return {
    id,
    title: id,
    year: 2000,
    releaseDate: "2000-01-01",
    universe,
    kind: "movie",
    required: true,
    runtimeSec: 60,
    phase: "Test",
    wikiTitle: id,
    summary: "",
    lore: "",
    ...extra,
  };
}

describe("building a graph refuses broken catalogues", () => {
  it("rejects a `requires` entry that names an unknown id", () => {
    expect(() => buildGraph([title("a", "street", { requires: ["nope"] })])).toThrow(
      '"a" requires "nope", which is not in the catalogue.',
    );
  });

  it("rejects an `alsoRequires` entry that names an unknown id", () => {
    expect(() => buildGraph([title("a", "mcu"), title("b", "mcu", { alsoRequires: ["ghost"] })])).toThrow(
      '"b" requires "ghost", which is not in the catalogue.',
    );
  });

  it("rejects a two-title cycle and names both titles", () => {
    const build = () =>
      buildGraph([title("a", "street", { requires: ["b"] }), title("b", "street", { requires: ["a"] })]);
    expect(build).toThrow("Prerequisite cycle: a -> b -> a.");
  });

  it("rejects a longer cycle and names the whole loop", () => {
    const build = () =>
      buildGraph([
        title("a", "street", { requires: ["c"] }),
        title("b", "street", { requires: ["a"] }),
        title("c", "street", { requires: ["b"] }),
        title("d", "street", { requires: ["a"] }),
      ]);
    expect(build).toThrow("Prerequisite cycle: a -> c -> b -> a.");
  });

  it("rejects a cycle formed by an override against the release chain", () => {
    // In a release chain "b" already requires "a"; making "a" require "b" closes a loop.
    const build = () => buildGraph([title("a", "mcu", { requires: ["b"] }), title("b", "mcu")]);
    expect(build).toThrow(/Prerequisite cycle: .*a.*b|Prerequisite cycle: .*b.*a/);
  });

  it("rejects a title that requires itself", () => {
    expect(() => buildGraph([title("a", "street", { requires: ["a"] })])).toThrow('Prerequisite cycle: "a" requires itself.');
  });

  it("rejects a duplicated id", () => {
    expect(() => buildGraph([title("a", "mcu"), title("a", "xmen")])).toThrow('Catalogue id "a" is used by more than one title.');
  });

  it("rejects an explicit-policy (Street) title with no `requires` list", () => {
    expect(() => buildGraph([title("a", "street")])).toThrow(/"a" is in the street universe.*must list "requires"/);
  });

  it("accepts the real catalogue", () => {
    expect(() => buildGraph(CONTENT)).not.toThrow();
  });
});

describe("policies and overrides on a made-up catalogue", () => {
  const graph: PrerequisiteGraph = buildGraph([
    title("m1", "mcu"),
    title("m2", "mcu", { required: false }),
    title("m3", "mcu"),
    title("m4", "mcu", { requires: [] }),
    title("m5", "mcu", { alsoRequires: ["x1", "m1"] }),
    title("x1", "xmen"),
    title("x2", "xmen", { requires: ["x1"] }),
    title("s1", "street", { requires: [] }),
    title("s2", "street", { requires: ["s1", "m3"] }),
  ]);

  it("release chain: every earlier required title of the same universe, optional ones skipped", () => {
    expect(graph.directPrerequisites("m3")).toEqual(["m1"]);
    expect(graph.directPrerequisites("x1")).toEqual([]);
  });

  it("`requires` replaces the policy; `alsoRequires` is appended after it without duplicates", () => {
    expect(graph.directPrerequisites("m4")).toEqual([]);
    expect(graph.directPrerequisites("x2")).toEqual(["x1"]);
    expect(graph.directPrerequisites("m5")).toEqual(["m1", "m3", "m4", "x1"]);
  });

  it("explicit policy: exactly the listed ids, and they may cross universes", () => {
    expect(graph.directPrerequisites("s2")).toEqual(["s1", "m3"]);
    expect(graph.prerequisiteChain("s2")).toEqual(["s1", "m1", "m3", "s2"]);
  });

  it("dependents are every title that transitively needs the given one, in catalogue order", () => {
    // An optional title still has prerequisites (m2 needs m1); it just never gates anything.
    expect(graph.dependents("m1")).toEqual(["m2", "m3", "m5", "s2"]);
    expect(graph.dependents("m2")).toEqual([]);
  });

  it("reduced edges drop a direct edge that another prerequisite already implies", () => {
    // m5 directly needs m1, m3, m4 and x1; m1 is dropped because m3 already needs it.
    expect(graph.reducedEdges().filter((edge) => edge.to === "m5")).toEqual([
      { from: "m3", to: "m5" },
      { from: "m4", to: "m5" },
      { from: "x1", to: "m5" },
    ]);
  });

  it("answers an unknown id with empty lists instead of throwing", () => {
    expect(graph.directPrerequisites("removed-title")).toEqual([]);
    expect(graph.prerequisiteChain("removed-title")).toEqual([]);
    expect(graph.dependents("removed-title")).toEqual([]);
  });

  it("returns fresh arrays, so a caller cannot change the graph", () => {
    graph.directPrerequisites("m3").push("x1");
    graph.prerequisiteChain("m3").length = 0;
    graph.dependents("m1").pop();
    expect(graph.directPrerequisites("m3")).toEqual(["m1"]);
    expect(graph.prerequisiteChain("m3")).toEqual(["m1", "m3"]);
    expect(graph.dependents("m1")).toEqual(["m2", "m3", "m5", "s2"]);
  });
});

describe("the real catalogue", () => {
  it("carries exactly the overrides in plan §4.4 outside the Street universe", () => {
    const overrides = Object.fromEntries(
      CONTENT.filter((item) => item.universe !== "street" && (item.requires || item.alsoRequires)).map((item) => [
        item.id,
        { ...(item.requires && { requires: item.requires }), ...(item.alsoRequires && { alsoRequires: item.alsoRequires }) },
      ]),
    );
    expect(overrides).toEqual({
      "moon-knight": { requires: [] },
      "multiverse-of-madness": { alsoRequires: ["xmen-2000"] },
      deadpool: { requires: ["xmen-2000"] },
      "deadpool-2": { requires: ["deadpool"] },
    });
  });

  it("chains through the barrel are the graph's chains", () => {
    for (const item of CONTENT) {
      expect(getPrerequisiteChain(item).map((step) => step.id), item.id).toEqual(prerequisiteChain(item.id));
    }
  });

  it("spot values from plan §4.4", () => {
    const prerequisites = (id: string) => prerequisiteChain(id).length - 1;
    expect({
      endgame: prerequisites("endgame"),
      "multiverse-of-madness": prerequisites("multiverse-of-madness"),
      hawkeye: prerequisites("hawkeye"),
      echo: prerequisites("echo"),
      deadpool: prerequisites("deadpool"),
      "deadpool-2": prerequisites("deadpool-2"),
      logan: prerequisites("logan"),
      "deadpool-wolverine": prerequisites("deadpool-wolverine"),
      "born-again-1": prerequisites("born-again-1"),
      visionquest: prerequisites("visionquest"),
      "moon-knight": prerequisites("moon-knight"),
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

    expect(dependents("iron-man")).toHaveLength(60);
    expect(dependents("endgame")).toHaveLength(39);
    const fromXmen = dependents("xmen-2000").map((id) => CONTENT_BY_ID.get(id)!.universe);
    expect({ total: fromXmen.length, xmen: fromXmen.filter((u) => u === "xmen").length, mcu: fromXmen.filter((u) => u === "mcu").length }).toEqual({
      total: 41,
      xmen: 13,
      mcu: 28,
    });
  });

  it("no optional title has dependents", () => {
    expect(CONTENT.filter((item) => !item.required && dependents(item.id).length > 0).map((item) => item.id)).toEqual([]);
  });

  it("dependents are exactly the inverse of the chains", () => {
    for (const item of CONTENT) {
      const expected = CONTENT.filter((other) => other.id !== item.id && prerequisiteChain(other.id).includes(item.id)).map(
        (other) => other.id,
      );
      expect(dependents(item.id), item.id).toEqual(expected);
    }
  });

  it("with nothing watched, the earliest missing prerequisite is the one in plan §4.7", () => {
    const missing = (id: string) => missingPrerequisite(CONTENT_BY_ID.get(id)!, new Set())?.id ?? null;
    expect({
      hawkeye: missing("hawkeye"),
      echo: missing("echo"),
      "multiverse-of-madness": missing("multiverse-of-madness"),
      "deadpool-2": missing("deadpool-2"),
      "born-again-2": missing("born-again-2"),
      "moon-knight": missing("moon-knight"),
    }).toEqual({
      hawkeye: "iron-man",
      echo: "iron-man",
      "multiverse-of-madness": "iron-man",
      "deadpool-2": "xmen-2000",
      "born-again-2": "defenders-daredevil-1",
      "moon-knight": null,
    });
  });

  describe("reduced edges", () => {
    const edges = reducedEdges();
    const parents = (id: string) => edges.filter((edge) => edge.to === id).map((edge) => edge.from);

    it("are a subset of the direct edges", () => {
      for (const { from, to } of edges) expect(directPrerequisites(to), `${from} -> ${to}`).toContain(from);
    });

    it("keep exactly the same reachability as the full graph", () => {
      const reach = new Map<string, Set<string>>();
      const ancestorsVia = (id: string): Set<string> => {
        const cached = reach.get(id);
        if (cached) return cached;
        const found = new Set<string>();
        for (const parent of parents(id)) {
          found.add(parent);
          for (const ancestor of ancestorsVia(parent)) found.add(ancestor);
        }
        reach.set(id, found);
        return found;
      };
      for (const item of CONTENT) {
        expect([...ancestorsVia(item.id)].sort(), item.id).toEqual(prerequisiteChain(item.id).slice(0, -1).sort());
      }
    });

    it("are minimal: no kept edge is implied by another parent", () => {
      for (const { from, to } of edges) {
        const implied = parents(to).some((other) => other !== from && prerequisiteChain(other).includes(from));
        expect(implied, `${from} -> ${to}`).toBe(false);
      }
    });

    it("spot checks", () => {
      expect(parents("iron-man-2")).toEqual(["incredible-hulk"]);
      expect(parents("multiverse-of-madness")).toEqual(["no-way-home", "xmen-2000"]);
      expect(parents("hawkeye")).toEqual(["endgame"]);
      expect(parents("deadpool-2")).toEqual(["deadpool"]);
      expect(parents("defenders-the-defenders")).toEqual([
        "defenders-daredevil-2",
        "defenders-jessica-jones-1",
        "defenders-luke-cage-1",
        "defenders-iron-fist-1",
      ]);
      expect(parents("moon-knight")).toEqual([]);
    });
  });
});
