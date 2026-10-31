"use client";

import Image from "next/image";

import { CONTENT, type ContentItem } from "@/lib/content";
import { posterUrl } from "@/lib/media";

const COLUMN_COUNT = 4;
const WALL_ITEMS = CONTENT.filter((_, index) => index % 4 === 1).slice(0, 24);

/** A purely decorative, slowly drifting poster wall behind the sign-in screen's intro column. No per-user data; same set for every visitor. */
export function AuthPosterWall() {
  const columns: ContentItem[][] = Array.from({ length: COLUMN_COUNT }, () => []);
  WALL_ITEMS.forEach((item, index) => columns[index % COLUMN_COUNT].push(item));

  return (
    <div className="auth-wall" aria-hidden="true">
      {columns.map((column, columnIndex) => (
        <div key={columnIndex} className={`auth-wall-col ${columnIndex % 2 === 0 ? "drift-up" : "drift-down"}`}>
          {[...column, ...column].map((item, itemIndex) => (
            <div key={`${item.id}-${itemIndex}`} className="auth-wall-poster">
              <Image src={posterUrl(item)} alt="" fill sizes="200px" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
