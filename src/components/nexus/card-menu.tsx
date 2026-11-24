"use client";

import { Ellipsis } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type CardMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
};

/**
 * A card's "more actions" menu (package 2.2 adds "Skip this title"; 2.7 adds more). It follows
 * the menu-button pattern: a click, Enter, Space or Arrow Down opens it with focus on the first
 * item; Arrow keys, Home and End move between items; Escape closes it and puts focus back on the
 * button; Tab, a press anywhere else, or focus moving elsewhere closes it.
 */
export function CardMenu({ label, items }: { label: string; items: CardMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const current = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(current + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? entries[0] : entries.at(-1))?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div
      className="card-menu"
      onBlur={(event) => {
        // Focus moved to something else on the page (a keyboard shortcut, say): close. A press
        // that leaves focus nowhere (relatedTarget null, as Safari does) is handled by pointerdown.
        const next = event.relatedTarget as Node | null;
        if (open && next && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="card-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Ellipsis size={17} />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} className="card-menu-list" role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                // Focus goes back to the button first, so a dialog the item opens returns it there.
                triggerRef.current?.focus();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
