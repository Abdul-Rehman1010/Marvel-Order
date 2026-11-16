/**
 * The prerequisite graph (NEXT_LEVEL_PLAN.md §4.4). Pure: no I/O, no clock, no user data.
 *
 * Each universe has a policy:
 * - `release-chain` (MCU, X-Men): a title directly requires every earlier `required` title
 *   in its own universe list.
 * - `explicit` (Street-Level): a title requires exactly what its `requires` field lists.
 *
 * Per-title overrides on the catalogue item: `requires` REPLACES the policy result;
 * `alsoRequires` is appended after it. The order of direct prerequisites matters: it
 * decides the watch order of a chain and which unfinished title is named first.
 *
 * Built once at module load. Building throws when a title names an unknown id, when the
 * graph has a cycle, when an id is duplicated, or when an explicit-policy title has no
 * `requires` list. Those are mistakes in the catalogue, caught by `npm test` and the build.
 *
 * Queries take content ids and return fresh arrays of ids. An id the catalogue does not
 * know (for example from an old progress row) gets an empty answer, never an exception.
 */
import { CONTENT } from "../catalogue";
import type { ContentItem, Universe } from "../catalogue/types";

export type UniversePolicy = "release-chain" | "explicit";

export const UNIVERSE_POLICY: Readonly<Record<Universe, UniversePolicy>> = {
  mcu: "release-chain",
  xmen: "release-chain",
  street: "explicit",
};

/** One edge of the transitive reduction: `to` cannot be watched before `from`. */
export type GraphEdge = { from: string; to: string };

export type PrerequisiteGraph = {
  /** Every title id, in catalogue order. */
  readonly ids: readonly string[];
  directPrerequisites(id: string): string[];
  /** All transitive prerequisites in watch order, then the title itself (empty for an unknown id). */
  prerequisiteChain(id: string): string[];
  /** Every title that transitively depends on `id`, in catalogue order. */
  dependents(id: string): string[];
  /** The fewest edges with the same reachability (for the timeline map in 5.3). */
  reducedEdges(): GraphEdge[];
};

export function buildGraph(
  items: readonly ContentItem[],
  policy: Readonly<Record<Universe, UniversePolicy>> = UNIVERSE_POLICY,
): PrerequisiteGraph {
  const byId = new Map<string, ContentItem>();
  for (const item of items) {
    if (byId.has(item.id)) throw new Error(`Catalogue id "${item.id}" is used by more than one title.`);
    byId.set(item.id, item);
  }

  // DIRECT: the policy result (or the `requires` override), then `alsoRequires`, de-duplicated.
  const direct = new Map<string, string[]>();
  for (const item of items) {
    let base: string[];
    if (item.requires !== undefined) {
      base = item.requires;
    } else if (policy[item.universe] === "explicit") {
      throw new Error(`"${item.id}" is in the ${item.universe} universe, which has no release chain, so it must list "requires" (use [] for none).`);
    } else {
      const list = items.filter((candidate) => candidate.universe === item.universe);
      base = list
        .slice(0, list.findIndex((candidate) => candidate.id === item.id))
        .filter((candidate) => candidate.required)
        .map((candidate) => candidate.id);
    }
    const ids = [...new Set([...base, ...(item.alsoRequires ?? [])])];
    for (const id of ids) {
      if (id === item.id) throw new Error(`Prerequisite cycle: "${item.id}" requires itself.`);
      if (!byId.has(id)) throw new Error(`"${item.id}" requires "${id}", which is not in the catalogue.`);
    }
    direct.set(item.id, ids);
  }

  assertAcyclic(items, direct);

  // ANCESTORS: post-order depth-first walk over DIRECT, in declared order. This is exactly the
  // order today's `getPrerequisiteChain` produced, so watch order is unchanged.
  const ancestors = new Map<string, string[]>();
  for (const item of items) {
    const chain: string[] = [];
    const added = new Set<string>();
    const visit = (id: string) => {
      if (added.has(id)) return;
      for (const prerequisite of direct.get(id)!) visit(prerequisite);
      added.add(id);
      chain.push(id);
    };
    visit(item.id);
    chain.pop(); // the title itself
    ancestors.set(item.id, chain);
  }

  // DESCENDANTS: the inverse of ANCESTORS, kept in catalogue order.
  const descendants = new Map<string, string[]>(items.map((item) => [item.id, []]));
  for (const item of items) {
    for (const ancestor of ancestors.get(item.id)!) descendants.get(ancestor)!.push(item.id);
  }

  const ids = items.map((item) => item.id);
  const ancestorSets = new Map(items.map((item) => [item.id, new Set(ancestors.get(item.id))]));

  return {
    ids,
    directPrerequisites: (id) => [...(direct.get(id) ?? [])],
    prerequisiteChain: (id) => (byId.has(id) ? [...ancestors.get(id)!, id] : []),
    dependents: (id) => [...(descendants.get(id) ?? [])],
    reducedEdges: () =>
      ids.flatMap((to) => {
        const parents = direct.get(to)!;
        // Keep a direct edge only if no other direct prerequisite already leads to it.
        return parents
          .filter((from) => !parents.some((other) => other !== from && ancestorSets.get(other)!.has(from)))
          .map((from) => ({ from, to }));
      }),
  };
}

function assertAcyclic(items: readonly ContentItem[], direct: ReadonlyMap<string, string[]>) {
  const done = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (onPath.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id];
      throw new Error(`Prerequisite cycle: ${cycle.join(" -> ")}.`);
    }
    onPath.add(id);
    path.push(id);
    for (const prerequisite of direct.get(id)!) visit(prerequisite);
    path.pop();
    onPath.delete(id);
    done.add(id);
  };
  for (const item of items) visit(item.id);
}

const GRAPH = buildGraph(CONTENT);

/** Direct prerequisite ids, in the order they are checked. */
export function directPrerequisites(id: string): string[] {
  return GRAPH.directPrerequisites(id);
}

/** Every prerequisite in watch order, followed by the title itself. Replaces `getPrerequisiteChain`. */
export function prerequisiteChain(id: string): string[] {
  return GRAPH.prerequisiteChain(id);
}

/** Every title that cannot be watched before `id`, in catalogue order. */
export function dependents(id: string): string[] {
  return GRAPH.dependents(id);
}

/** Transitive reduction of the graph: the edges a map needs to draw. */
export function reducedEdges(): GraphEdge[] {
  return GRAPH.reducedEdges();
}
