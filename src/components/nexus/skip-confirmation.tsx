"use client";

import { Eye, EyeOff, SkipForward } from "lucide-react";
import { useState } from "react";

import type { ContentItem } from "@/lib/catalogue/types";
import type { SkipImpact } from "@/lib/client/feedback";
import { useDialogBehavior } from "@/lib/use-motion";

/**
 * Asks before a title is skipped (package 2.2): a skipped title counts as cleared for unlocking
 * later titles, but not as watched. Says what the skip opens and what it keeps. When the title has
 * a recap (`src/lib/catalogue/extras.ts`), it sits behind a spoiler toggle.
 */
export function SkipConfirmation({
  item,
  impact,
  recap,
  onCancel,
  onConfirm,
}: {
  item: ContentItem;
  impact: SkipImpact | null;
  recap?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useDialogBehavior(onCancel);
  const [revealed, setRevealed] = useState(false);
  const unlocks = impact?.unlocks ?? [];
  const kept = impact?.keptUnits ?? 0;
  const facts = [
    ...(unlocks.length ? [`Skipping it unlocks ${unlocks[0].title}${unlocks.length > 1 ? ` and ${unlocks.length - 1} more` : ""}.`] : []),
    ...(item.required ? [] : ["Optional titles never lock anything, so this only takes it off your list."]),
    ...(kept > 0 ? [`Your ${kept} watched episode${kept === 1 ? " stays" : "s stay"}.`] : []),
    "You can un-skip it later, or still mark it watched.",
  ];

  return (
    <div className="confirmation-shell">
      <button className="confirmation-backdrop" onClick={onCancel} aria-label="Cancel skipping" />
      <section
        ref={dialogRef}
        className="confirmation-dialog skip-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="skip-title"
        aria-describedby="skip-description skip-facts"
        tabIndex={-1}
      >
        <div className="confirmation-icon"><SkipForward size={22} /></div>
        <p className="eyebrow">TIMELINE BYPASS</p>
        <h2 id="skip-title">Skip {item.title}?</h2>
        <p id="skip-description">It will count as cleared for unlocking later titles, but not as watched.</p>
        <ul id="skip-facts" className="skip-facts">
          {facts.map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
        {recap && (
          <div className="skip-recap">
            <strong>What you need to know</strong>
            <button type="button" className="skip-recap-toggle" aria-expanded={revealed} aria-controls="skip-recap-text" onClick={() => setRevealed((current) => !current)}>
              {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
              {revealed ? "Hide the recap" : "Reveal (spoilers for this title)"}
            </button>
            <p id="skip-recap-text" hidden={!revealed}>{recap}</p>
          </div>
        )}
        <div className="confirmation-actions">
          <button className="secondary-action" data-autofocus onClick={onCancel}>Cancel</button>
          <button className="primary-action" onClick={onConfirm}><SkipForward size={16} /> Skip title</button>
        </div>
      </section>
    </div>
  );
}
