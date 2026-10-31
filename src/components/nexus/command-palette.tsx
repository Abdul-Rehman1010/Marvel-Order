"use client";

import Image from "next/image";
import { Check, Compass, LockKeyhole, Orbit } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { CONTENT, isUnlocked, itemComplete, type ContentItem, type Universe } from "@/lib/content";
import { posterUrl } from "@/lib/media";
import { useDialogBehavior } from "@/lib/use-motion";

const UNIVERSE_TAGS: Record<Universe, string> = { mcu: "MCU", xmen: "X-Men", street: "Street-Level" };

export function CommandPalette({
  onClose,
  watched,
  onOpenItem,
  onSelectUniverse,
  onOpenLore,
}: {
  onClose: () => void;
  watched: Set<string>;
  onOpenItem: (item: ContentItem) => void;
  onSelectUniverse: (universe: Universe) => void;
  onOpenLore: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useDialogBehavior(onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const trimmed = query.trim().toLocaleLowerCase();
    if (!trimmed) return CONTENT.slice(0, 8);
    const starts: ContentItem[] = [];
    const contains: ContentItem[] = [];
    for (const item of CONTENT) {
      const title = item.title.toLocaleLowerCase();
      if (title.startsWith(trimmed)) starts.push(item);
      else if (title.includes(trimmed)) contains.push(item);
    }
    return [...starts, ...contains].slice(0, 24);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function activate(item: ContentItem) {
    onOpenItem(item);
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(results.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = results[activeIndex];
      if (picked) activate(picked);
    }
  }

  return (
    <div className="palette-shell">
      <button className="palette-backdrop" onClick={onClose} aria-label="Close command palette" />
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Search the Doom Flix archive" tabIndex={-1}>
        <label className="palette-search">
          <Compass size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder={`Search all ${CONTENT.length} transmissions…`}
            aria-label="Search the archive"
          />
          <kbd>ESC</kbd>
        </label>

        {!query && (
          <div className="palette-quick-row">
            <button onClick={() => { onSelectUniverse("mcu"); onClose(); }}>MCU</button>
            <button onClick={() => { onSelectUniverse("xmen"); onClose(); }}>X-Men</button>
            <button onClick={() => { onSelectUniverse("street"); onClose(); }}>Street</button>
            <button onClick={() => { onOpenLore(); onClose(); }}><Orbit size={13} /> Lore brief</button>
          </div>
        )}

        <div ref={listRef} className="palette-results">
          {results.map((item, index) => {
            const complete = itemComplete(item, watched);
            const unlocked = isUnlocked(item, watched);
            return (
              <button
                key={item.id}
                data-index={index}
                className={`palette-row ${index === activeIndex ? "active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activate(item)}
              >
                <span className="palette-thumb"><Image src={posterUrl(item)} alt="" fill sizes="32px" /></span>
                <span className="palette-copy">
                  <strong>{item.title}</strong>
                  <small>{UNIVERSE_TAGS[item.universe]} · {item.phase}</small>
                </span>
                <span className="palette-state" aria-hidden="true">{complete ? <Check size={14} /> : !unlocked ? <LockKeyhole size={13} /> : null}</span>
              </button>
            );
          })}
          {!results.length && (
            <div className="palette-empty">
              <Compass size={20} />
              <p>No transmission matches &ldquo;{query}&rdquo;.</p>
            </div>
          )}
        </div>

        <div className="palette-hints">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> switch universe</span>
          <span><kbd>N</kbd> next up</span>
        </div>
      </section>
    </div>
  );
}
