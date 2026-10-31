import type { ContentItem } from "./content";

export function posterUrl(item: ContentItem) {
  return `/posters/${item.id}.webp`;
}

export function backdropUrl(item: ContentItem) {
  return `/backdrops/${item.id}.webp`;
}
