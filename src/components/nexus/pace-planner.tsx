"use client";

import { CalendarClock } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

const BUDGET_OPTIONS_MIN = [60, 120, 180] as const;
const STORAGE_KEY = "doomflix.pace.nightlyMinutes";
const DEFAULT_MINUTES = 120;

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours <= 0) return `${mins}m`;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

// No cross-tab sync needed — the snapshot only has to be read once, after
// hydration, without risking an SSR mismatch. See useSyncExternalStore below.
function subscribeNever() {
  return () => {};
}
function getStoredMinutesSnapshot() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MINUTES;
  } catch {
    return DEFAULT_MINUTES;
  }
}
function getServerMinutesSnapshot() {
  return DEFAULT_MINUTES;
}

/**
 * A small planning addendum for the global Doomsday runtime card: projects a
 * finish date from a chosen nightly-viewing budget. Pure UI convenience —
 * never changes the underlying remaining-runtime figures it reads.
 */
export function PacePlanner({
  remainingSeconds,
  daysLeft,
  complete,
}: {
  remainingSeconds: number;
  daysLeft: number;
  complete: boolean;
}) {
  const storedMinutes = useSyncExternalStore(subscribeNever, getStoredMinutesSnapshot, getServerMinutesSnapshot);
  const [overrideMinutes, setOverrideMinutes] = useState<number | null>(null);
  const nightlyMinutes = overrideMinutes ?? storedMinutes;

  function choose(minutes: number) {
    setOverrideMinutes(minutes);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(minutes));
    } catch {
      // Per-viewer convenience only; nothing else depends on this persisting.
    }
  }

  if (complete) {
    return (
      <div className="pace-planner complete">
        <CalendarClock size={13} />
        <span>Doomsday readiness complete — no pace needed.</span>
      </div>
    );
  }

  if (daysLeft <= 0) {
    return (
      <div className="pace-planner complete">
        <CalendarClock size={13} />
        <span>The countdown has reached zero.</span>
      </div>
    );
  }

  const remainingMinutes = remainingSeconds / 60;
  const requiredMinutesPerDay = remainingMinutes / daysLeft;
  const daysNeeded = Math.ceil(remainingMinutes / nightlyMinutes);
  const spareDays = daysLeft - daysNeeded;
  const onTrack = spareDays >= 0;

  return (
    <div className="pace-planner">
      <div className="pace-planner-head">
        <CalendarClock size={13} />
        <span>≈ {formatMinutes(requiredMinutesPerDay)} a day keeps you on schedule</span>
      </div>
      <div className="pace-budget-row" role="group" aria-label="Nightly viewing budget">
        {BUDGET_OPTIONS_MIN.map((minutes) => (
          <button key={minutes} type="button" aria-pressed={minutes === nightlyMinutes} className={minutes === nightlyMinutes ? "active" : ""} onClick={() => choose(minutes)}>
            {minutes / 60}h/night
          </button>
        ))}
      </div>
      <p className={`pace-projection ${onTrack ? "on-track" : "behind"}`}>
        {onTrack ? `On track · ${spareDays} day${spareDays === 1 ? "" : "s"} to spare` : `${Math.abs(spareDays)} day${Math.abs(spareDays) === 1 ? "" : "s"} short at this pace`}
      </p>
    </div>
  );
}
