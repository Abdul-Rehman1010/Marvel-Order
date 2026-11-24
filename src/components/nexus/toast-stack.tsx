"use client";

import { PartyPopper, Sparkles, Undo2, X } from "lucide-react";

import type { ToastSpec, UndoTarget } from "@/lib/client/feedback";
import type { ContentItem } from "@/lib/content";

/** What `actionToasts` (src/lib/client/feedback.ts) produces for an action. */
export type DelightToastInput = ToastSpec;

// Intersecting (rather than Omit-ing) keeps this distributive over the union,
// so each variant keeps only its own fields plus `id`.
export type DelightToast = DelightToastInput & { id: number };

/**
 * A stack of ephemeral celebration toasts, separate from the existing
 * single-slot error `.toast` in marvel-nexus.tsx. Kept independent so the
 * proven error/notice flow is never touched.
 */
export function ToastStack({
  toasts,
  onDismiss,
  onOpenItem,
  onUndo,
}: {
  toasts: DelightToast[];
  onDismiss: (id: number) => void;
  onOpenItem: (item: ContentItem) => void;
  /** The checkpoint toast's Undo: un-watch the unit it names (and restore a skip the watch ended). */
  onUndo: (target: UndoTarget) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="delight-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`delight-toast ${toast.kind}`} role="status">
          <span className="delight-icon">{toast.kind === "milestone" ? <PartyPopper size={16} /> : <Sparkles size={16} />}</span>
          <div className="delight-copy">
            {toast.kind === "unlock" ? (
              <>
                <strong>New transmission unlocked</strong>
                <p>{toast.item.title} is ready to watch.{toast.more > 0 && ` +${toast.more} more unlocked.`}</p>
              </>
            ) : (
              <>
                <strong>{toast.title}</strong>
                <p>{toast.detail}</p>
              </>
            )}
          </div>
          {toast.kind === "unlock" && (
            <button
              className="delight-action"
              onClick={() => {
                onOpenItem(toast.item);
                onDismiss(toast.id);
              }}
            >
              Open
            </button>
          )}
          {toast.kind === "checkpoint" && toast.undo && (
            <button
              className="delight-action"
              onClick={() => {
                if (toast.undo) onUndo(toast.undo);
                onDismiss(toast.id);
              }}
            >
              <Undo2 size={13} /> Undo
            </button>
          )}
          <button className="delight-dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
