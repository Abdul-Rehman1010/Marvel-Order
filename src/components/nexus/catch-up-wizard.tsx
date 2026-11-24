"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, Check, CheckCheck, CircleHelp, ListChecks, Plus, SkipForward, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CONTENT_BY_ID } from "@/lib/catalogue";
import type { ContentItem, Universe } from "@/lib/catalogue/types";
import {
  CATCH_UP_STEPS,
  addedFromOtherUniverses,
  catchUpSummary,
  lastReleasedRequired,
  planCatchUp,
  selectableTitles,
  streetChoices,
  titlesThrough,
  type CatchUpDraft,
  type CatchUpPlan,
  type CatchUpRow,
  type CatchUpStep,
} from "@/lib/client/catch-up";
import { formatDuration, formatRuntimeOf } from "@/lib/engine/format";
import type { Action } from "@/lib/engine/reducer";
import { indexOf, isWatchedComplete, type ViewingIndex, type ViewingState } from "@/lib/engine/state";
import { posterUrl } from "@/lib/media";
import { useDialogBehavior } from "@/lib/use-motion";

/** Why the catch-up was not saved: the rules refused it here, or the server did. */
export type CatchUpFailure = { code: string; message: string; contentId?: string; missingId?: string };

const STEP_LABEL: Record<CatchUpStep, string> = { mcu: "MCU", xmen: "X-Men", street: "Street-Level", review: "Review" };
const STEP_QUESTION: Record<CatchUpStep, string> = {
  mcu: "What is the latest MCU title you've seen?",
  xmen: "What is the latest X-Men film you've seen?",
  street: "Which Street-Level seasons have you seen?",
  review: "Check the list, then save it",
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const titleOf = (id: string | undefined) => (id ? CONTENT_BY_ID.get(id)?.title ?? id : "");

/** "2008 · 2h 06m" for a film, "13 episodes" for a series. */
function metaOf(item: ContentItem) {
  if (item.kind === "series") return `${item.year} · ${plural(item.episodes?.length ?? 0, "episode")}`;
  return `${item.year} · ${item.kind === "special" ? "Special · " : ""}${formatRuntimeOf(item.runtimeSec)}`;
}

function Thumb({ item }: { item: ContentItem }) {
  return (
    <span className="catchup-thumb" aria-hidden="true">
      <Image src={posterUrl(item)} alt="" fill sizes="36px" />
    </span>
  );
}

/** Consecutive titles that share a phase, in order. */
function byPhase(items: ContentItem[]) {
  const groups: { phase: string; items: ContentItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.phase === item.phase) last.items.push(item);
    else groups.push({ phase: item.phase, items: [item] });
  }
  return groups;
}

/** The MCU and X-Men steps: one "latest title seen", from the list or a quick pick. */
function PointStep({
  universe,
  draft,
  now,
  index,
  onPick,
}: {
  universe: "mcu" | "xmen";
  draft: CatchUpDraft;
  now: number;
  index: ViewingIndex;
  onPick: (id: string | null) => void;
}) {
  const point = universe === "mcu" ? draft.mcuPoint : draft.xmenPoint;
  const titles = useMemo(() => selectableTitles(universe, now), [universe, now]);
  const everything = lastReleasedRequired(universe, now);
  const quick: { label: string; value: string | null }[] = [
    { label: "Nothing yet", value: null },
    ...(universe === "mcu" ? [{ label: "Through Endgame", value: "endgame" }] : []),
    { label: "Everything released", value: everything },
  ];
  const covered = titlesThrough(universe, point, now).length;
  const fromMcu = universe === "xmen" ? addedFromOtherUniverses(draft, "xmen", now) : [];

  // The list is not scrolled to a quick pick's title: the line under the quick picks names it, and
  // jumping down the list would hide that line and the picks themselves.
  return (
    <>
      <p className="catchup-intro">Everything required up to the title you pick counts as watched. You can change single titles in Review.</p>
      <div className="catchup-quick" role="group" aria-label="Quick picks">
        {quick.map((option) => (
          <button key={option.label} type="button" aria-pressed={point === option.value} onClick={() => onPick(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
      <p className="catchup-count" aria-live="polite">
        {point ? `${plural(covered, "title")}, through ${titleOf(point)}` : universe === "mcu" ? "Nothing from the MCU" : "Nothing from the X-Men films"}
      </p>
      {fromMcu.length > 0 && (
        <p className="catchup-note">Your MCU pick needs {fromMcu.map((item) => item.title).join(", ")}, so {fromMcu.length === 1 ? "it is" : "they are"} included already.</p>
      )}
      <div className="catchup-list">
        {byPhase(titles).map((group) => (
          <fieldset key={group.phase} className="catchup-group">
            <legend>{group.phase}</legend>
            {group.items.map((item) => (
              <label key={item.id} className="catchup-option" data-id={item.id}>
                <input type="radio" name={`catchup-${universe}`} value={item.id} checked={point === item.id} onChange={() => onPick(item.id)} />
                <Thumb item={item} />
                <span className="catchup-option-copy">
                  <strong>{item.title}</strong>
                  <small>{metaOf(item)}{item.required ? "" : " · Optional"}</small>
                </span>
                {isWatchedComplete(item, index) && <span className="catchup-done" title="Already watched"><Check size={14} /><span className="sr-only">Already watched</span></span>}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </>
  );
}

/** The Street-Level step: tick the seasons seen; the seasons they need are ticked too. */
function StreetStep({ draft, now, index, onToggle }: { draft: CatchUpDraft; now: number; index: ViewingIndex; onToggle: (id: string) => void }) {
  const titles = useMemo(() => selectableTitles("street", now), [now]);
  const { checked, neededBy, crossFor } = streetChoices(draft, now);
  return (
    <>
      <p className="catchup-intro">Tick what you have seen. A season that a ticked one needs is ticked for you, with a note saying why.</p>
      <div className="catchup-list">
        {titles.map((item) => {
          const picked = draft.streetPicks.includes(item.id);
          const auto = checked.has(item.id) && !picked;
          const cross = crossFor.get(item.id);
          const noteId = `catchup-note-${item.id}`;
          return (
            <label key={item.id} className="catchup-option check" data-id={item.id}>
              <input type="checkbox" checked={checked.has(item.id)} disabled={auto} aria-describedby={auto || cross ? noteId : undefined} onChange={() => onToggle(item.id)} />
              <Thumb item={item} />
              <span className="catchup-option-copy">
                <strong>{item.title}</strong>
                <small>{metaOf(item)}</small>
                {auto && <small id={noteId} className="catchup-added">Ticked because {titleOf(neededBy.get(item.id))} needs it</small>}
                {!auto && cross && (
                  <small id={noteId} className="catchup-added">
                    Also adds {plural(cross.length, "earlier title")} it needs, through {cross.at(-1)!.title}
                  </small>
                )}
              </span>
              {isWatchedComplete(item, index) && <span className="catchup-done" title="Already watched"><Check size={14} /><span className="sr-only">Already watched</span></span>}
            </label>
          );
        })}
      </div>
    </>
  );
}

const UNIVERSE_HEADING: Record<Universe, string> = { mcu: "MCU", xmen: "X-Men", street: "Street-Level" };

function ReviewRow({ row, onToggle }: { row: CatchUpRow; onToggle: (id: string, seen: boolean) => void }) {
  const { item } = row;
  const meta = item.kind === "series"
    ? `${plural(row.units, "episode")} · ${formatDuration(row.seconds)}`
    : `${item.year} · ${item.kind === "special" ? "Special · " : ""}${formatRuntimeOf(item.runtimeSec)}`;
  const state = row.seen ? "seen" : item.required ? "skip" : "out";
  return (
    <li className={`catchup-row ${state}`}>
      <span className="catchup-row-copy">
        <strong>{item.title}</strong>
        <small>
          {meta}
          {!item.required && " · Optional"}
        </small>
        {row.neededBy && <small className="catchup-added">Added: {row.neededBy.title} needs it</small>}
        {state === "skip" && <small className="catchup-skip-note"><SkipForward size={12} /> Will be skipped, so later titles stay unlocked</small>}
        {state === "out" && <small className="catchup-out-note">Not included</small>}
      </span>
      <button type="button" className="catchup-toggle" aria-pressed={!row.seen} aria-label={`Haven't seen ${item.title}`} onClick={() => onToggle(item.id, !row.seen)}>
        Haven&apos;t seen this
      </button>
    </li>
  );
}

function ReviewStep({
  plan,
  failure,
  onToggle,
  onAdd,
}: {
  plan: CatchUpPlan;
  failure: CatchUpFailure | null;
  onToggle: (id: string, seen: boolean) => void;
  onAdd: (id: string) => void;
}) {
  const groups = (["mcu", "xmen", "street"] as const)
    .map((universe) => ({ universe, rows: plan.rows.filter((row) => row.item.universe === universe) }))
    .filter((group) => group.rows.length);
  const missing = failure?.missingId && CONTENT_BY_ID.has(failure.missingId) ? failure.missingId : null;
  const listed = (id: string) => plan.watch.includes(id) || plan.skip.includes(id);
  return (
    <>
      <p className="catchup-summary" aria-live="polite">{catchUpSummary(plan)}</p>
      {failure && (
        <div className="catchup-failure" role="alert">
          <Zap size={17} />
          <div>
            <strong>Not saved</strong>
            <p>
              {missing
                ? listed(missing)
                  ? `${titleOf(failure.contentId)} needs ${titleOf(missing)}. Your progress had changed elsewhere; the list now includes it, so check it and save again.`
                  : `${titleOf(failure.contentId)} needs ${titleOf(missing)}, which is not in this list.`
                : `${failure.contentId ? `${titleOf(failure.contentId)}: ` : ""}${failure.message}`}
            </p>
            {missing && !listed(missing) && (
              <button type="button" className="secondary-action" onClick={() => onAdd(missing)}>
                <Plus size={15} /> Add {titleOf(missing)}
              </button>
            )}
          </div>
        </div>
      )}
      {plan.alreadyWatched > 0 && <p className="catchup-note">{plural(plan.alreadyWatched, "title")} you already marked watched {plan.alreadyWatched === 1 ? "stays" : "stay"} as {plan.alreadyWatched === 1 ? "it is" : "they are"}.</p>}
      {groups.length === 0 ? (
        <p className="catchup-empty">Nothing picked yet. Go back and choose the latest title you have seen.</p>
      ) : (
        groups.map((group) => (
          <section key={group.universe} className="catchup-review-group" aria-label={UNIVERSE_HEADING[group.universe]}>
            <h4>{UNIVERSE_HEADING[group.universe]}</h4>
            <ul>
              {group.rows.map((row) => <ReviewRow key={row.item.id} row={row} onToggle={onToggle} />)}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

/**
 * The catch-up wizard (package 2.3): mark everything already seen in under a minute. Opened after
 * sign-up, from the account panel, and from the prompt above an empty archive. It sends ONE `bulk`
 * action with `backfilled: true`, built by `src/lib/client/catch-up.ts` so the rules never refuse it.
 */
export function CatchUpWizard({
  state,
  now,
  initial,
  failure: initialFailure = null,
  onClose,
  onHowItWorks,
  onConfirm,
}: {
  state: ViewingState;
  /** The clock release dates are checked against (epoch milliseconds). */
  now: number;
  initial: CatchUpDraft;
  /** Why the last attempt was not saved (the server refused it after the wizard closed). */
  failure?: CatchUpFailure | null;
  onClose: () => void;
  /** Opens the lore guide; the wizard comes back with this draft afterwards. */
  onHowItWorks: (draft: CatchUpDraft) => void;
  /** Applies the action. Returns why it was refused, or null when it was applied. */
  onConfirm: (action: Extract<Action, { type: "bulk" }>, draft: CatchUpDraft) => CatchUpFailure | null;
}) {
  const dialogRef = useDialogBehavior(onClose);
  const [draft, setDraft] = useState<CatchUpDraft>(initial);
  const [failure, setFailure] = useState<CatchUpFailure | null>(initialFailure);
  const index = useMemo(() => indexOf(state), [state]);
  const plan = useMemo(() => planCatchUp(draft, state, now), [draft, state, now]);
  const stepIndex = CATCH_UP_STEPS.indexOf(draft.step);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Each new step starts at its top, with focus on its question (the first one gets it on open).
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    bodyRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [draft.step]);

  const update = (change: Partial<CatchUpDraft>) => setDraft((current) => ({ ...current, ...change }));
  const goTo = (step: CatchUpStep) => update({ step });

  function toggleStreet(id: string) {
    setDraft((current) => ({
      ...current,
      streetPicks: current.streetPicks.includes(id) ? current.streetPicks.filter((pick) => pick !== id) : [...current.streetPicks, id],
    }));
  }

  function setSeen(id: string, seen: boolean) {
    setDraft((current) => ({ ...current, seen: { ...current.seen, [id]: seen } }));
  }

  function addMissing(id: string) {
    setDraft((current) => ({ ...current, extra: [...current.extra, id], seen: { ...current.seen, [id]: true } }));
    setFailure(null);
  }

  function confirm() {
    if (!plan.action) return;
    setFailure(onConfirm(plan.action, draft));
  }

  const confirmLabel = plan.watch.length
    ? `Mark ${plural(plan.watch.length, "title")} watched${plan.skip.length ? ` and skip ${plan.skip.length}` : ""}`
    : plan.skip.length ? `Skip ${plural(plan.skip.length, "title")}` : "Nothing to mark";
  const next = CATCH_UP_STEPS[stepIndex + 1];
  const previous = CATCH_UP_STEPS[stepIndex - 1];

  return (
    <div className="confirmation-shell catchup-shell">
      <button className="confirmation-backdrop" onClick={onClose} aria-label="Close catch-up" />
      <section ref={dialogRef} className="catchup-dialog" role="dialog" aria-modal="true" aria-labelledby="catchup-title" aria-describedby="catchup-question" tabIndex={-1}>
        <header className="catchup-header">
          <div className="catchup-header-actions">
            <button type="button" className="catchup-help" aria-label="How it works" onClick={() => onHowItWorks(draft)}>
              <CircleHelp size={16} /> <span>How it works</span>
            </button>
            <button type="button" className="account-close" onClick={onClose} aria-label="Close catch-up"><X size={18} /></button>
          </div>
          <p className="eyebrow"><ListChecks size={14} /> CATCH-UP PROTOCOL</p>
          <h2 id="catchup-title">Catch up on what you&apos;ve watched</h2>
          <ol className="catchup-steps" aria-label="Steps">
            {CATCH_UP_STEPS.map((step, position) => (
              <li key={step} className={position < stepIndex ? "done" : position === stepIndex ? "current" : ""} aria-current={position === stepIndex ? "step" : undefined}>
                <span>{position + 1}</span> {STEP_LABEL[step]}
              </li>
            ))}
          </ol>
        </header>
        <div ref={bodyRef} className="catchup-body">
          <h3 id="catchup-question" ref={headingRef} tabIndex={-1} data-autofocus>{STEP_QUESTION[draft.step]}</h3>
          {draft.step === "mcu" && <PointStep universe="mcu" draft={draft} now={now} index={index} onPick={(id) => update({ mcuPoint: id })} />}
          {draft.step === "xmen" && <PointStep universe="xmen" draft={draft} now={now} index={index} onPick={(id) => update({ xmenPoint: id })} />}
          {draft.step === "street" && <StreetStep draft={draft} now={now} index={index} onToggle={toggleStreet} />}
          {draft.step === "review" && <ReviewStep plan={plan} failure={failure} onToggle={setSeen} onAdd={addMissing} />}
        </div>
        {/* A div, not <footer>: the page footer's element styles would apply to it. */}
        <div className="catchup-footer">
          <div className="catchup-nav">
            {previous && <button type="button" className="secondary-action" onClick={() => goTo(previous)}><ArrowLeft size={16} /> Back</button>}
            {next ? (
              <button type="button" className="primary-action" onClick={() => goTo(next)}>
                {next === "review" ? "Review" : "Next"} <ArrowRight size={16} />
              </button>
            ) : (
              <button type="button" className="primary-action" disabled={!plan.action} onClick={confirm}>
                <CheckCheck size={16} /> {confirmLabel}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
