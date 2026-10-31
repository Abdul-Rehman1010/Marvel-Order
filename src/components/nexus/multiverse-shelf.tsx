"use client";

import Image from "next/image";
import { ChevronRight, LockKeyhole } from "lucide-react";

import { isUnlocked, progressKey, type ContentItem, type Universe } from "@/lib/content";
import { posterUrl } from "@/lib/media";

const UNIVERSE_LABEL: Record<Universe, string> = { mcu: "MCU", xmen: "X-Men", street: "Street" };

type ShelfEntry =
  | { kind: "next"; universe: Universe; item: ContentItem }
  | { kind: "progress"; item: ContentItem; watchedEpisodes: number; totalEpisodes: number };

/** A horizontal rail under the billboard: the next required title per universe, plus any series in progress. Pure navigation — opens via the existing openArchiveItem flow. */
export function MultiverseShelf({
  nextByUniverse,
  inProgressSeries,
  watched,
  onOpenItem,
}: {
  nextByUniverse: Partial<Record<Universe, ContentItem>>;
  inProgressSeries: ContentItem[];
  watched: Set<string>;
  onOpenItem: (item: ContentItem) => void;
}) {
  const entries: ShelfEntry[] = [
    ...(["mcu", "xmen", "street"] as const)
      .filter((universe) => nextByUniverse[universe])
      .map((universe) => ({ kind: "next" as const, universe, item: nextByUniverse[universe]! })),
    ...inProgressSeries.map((item) => ({
      kind: "progress" as const,
      item,
      watchedEpisodes: item.episodes?.filter((episode) => watched.has(progressKey(item.id, episode.id))).length ?? 0,
      totalEpisodes: item.episodes?.length ?? 0,
    })),
  ];

  if (!entries.length) return null;

  return (
    <section className="multiverse-shelf" aria-label="Across the multiverse">
      <p className="eyebrow">ACROSS THE MULTIVERSE</p>
      <div className="shelf-row">
        {entries.map((entry) => {
          const locked = entry.kind === "next" && !isUnlocked(entry.item, watched);
          return (
            <button key={`${entry.kind}-${entry.item.id}`} className="shelf-card" onClick={() => onOpenItem(entry.item)}>
              <span className="shelf-poster">
                <Image src={posterUrl(entry.item)} alt="" fill sizes="42px" />
                {entry.kind === "progress" && (
                  <span className="shelf-progress-bar"><span style={{ width: `${(entry.watchedEpisodes / Math.max(1, entry.totalEpisodes)) * 100}%` }} /></span>
                )}
                {locked && <span className="shelf-lock" aria-hidden="true"><LockKeyhole size={12} /></span>}
              </span>
              <span className="shelf-copy">
                <small>{entry.kind === "next" ? `${UNIVERSE_LABEL[entry.universe]} · Next up` : `${entry.watchedEpisodes}/${entry.totalEpisodes} episodes`}</small>
                <strong>{entry.item.title}</strong>
              </span>
              <ChevronRight size={14} className="shelf-chevron" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
