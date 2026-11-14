"use client";

import Image from "next/image";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleUserRound,
  Clock3,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  Film,
  Fingerprint,
  Layers3,
  Link2Off,
  LockKeyhole,
  LogOut,
  Orbit,
  Play,
  Radio,
  Search,
  ShieldCheck,
  Star,
  Tv,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, Fragment, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CONTENT,
  CONTENT_BY_ID,
  getPrerequisiteChain,
  MCU_CONTENT,
  STREET_CONTENT,
  UNIVERSE_CONTENT,
  XMEN_CONTENT,
  formatRuntime,
  isUnlocked,
  itemComplete,
  itemUnits,
  missingPrerequisite,
  progressKey,
  unlockReason,
  type ContentItem,
  type Universe,
} from "@/lib/content";
import { normalizeWatchTitle, parseWatchLinksCsv, type WatchLinkCatalogue } from "@/lib/watch-links";
import { backdropUrl, posterUrl } from "@/lib/media";
import { useDialogBehavior, useGlassSpotlight, usePointerTilt } from "@/lib/use-motion";
import { DEFAULT_TINT, POSTER_TINTS } from "@/lib/poster-tints";
import { DoomClock } from "@/components/nexus/doom-clock";
import { ProgressReactor } from "@/components/nexus/progress-reactor";
import { ToastStack, type DelightToast, type DelightToastInput } from "@/components/nexus/toast-stack";
import { CommandPalette } from "@/components/nexus/command-palette";
import { PacePlanner } from "@/components/nexus/pace-planner";
import { MultiverseShelf } from "@/components/nexus/multiverse-shelf";
import { AuthPosterWall } from "@/components/nexus/auth-poster-wall";
import { LoreExperience } from "@/components/nexus/lore-experience";

type User = { id: string; username: string };
type ProgressRecord = { contentId: string; episode: number };
type RequirementFilter = "all" | "doomsday" | "optional";
type FormatFilter = "all" | "movie" | "series" | "special";
type PendingUnwatch = { item: ContentItem; episode: number; newerRecords: ProgressRecord[] };
type ScrollRequest = { contentId: string; token: number };
export type NexusApiRequest = (path: string, init?: RequestInit) => Promise<Response>;

const browserApiRequest: NexusApiRequest = (path, init) => fetch(path, init);

const DOOMSDAY = new Date("2026-12-18T00:00:00");

const INTRO_SLIDES = [
  { label: "CREATOR SIGNAL", title: "Developed by Abdul Rehman Shahid" },
  { label: "SPOILER PROTOCOL", title: "Every timeline follows its protected release order" },
  { label: "CROSS-PLATFORM ARCHIVE", title: "Your mission continues on web and mobile" },
] as const;


function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function useCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((DOOMSDAY.getTime() - now) / 1000));
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

function DoomsdayCountdown() {
  const countdown = useCountdown();
  return <DoomClock countdown={countdown} />;
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="scanner-orbit"><Orbit size={42} /></div>
      <p className="eyebrow">TVA ARCHIVE LINK</p>
      <h1>Calibrating the timeline</h1>
      <div className="loading-track"><span /></div>
    </main>
  );
}

function DeveloperCarousel({ placement }: { placement: "auth" | "dashboard" }) {
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % INTRO_SLIDES.length);
    }, 4600);
    return () => window.clearInterval(timer);
  }, []);

  const slide = INTRO_SLIDES[activeSlide];

  return (
    <section
      className={`developer-carousel ${placement}`}
      role="region"
      aria-roledescription="carousel"
      aria-label="Doom Flix introduction"
    >
      <div className="carousel-signal" aria-hidden="true"><Radio size={15} /></div>
      <div className="carousel-message" key={slide.label} aria-live="polite">
        <span>{slide.label}</span>
        <strong>{slide.title}</strong>
      </div>
      <div className="carousel-dots" aria-label="Choose introduction slide">
        {INTRO_SLIDES.map((item, index) => (
          <button
            key={item.label}
            type="button"
            className={index === activeSlide ? "active" : ""}
            onClick={() => setActiveSlide(index)}
            aria-label={`Show slide ${index + 1}: ${item.label.toLowerCase()}`}
            aria-current={index === activeSlide ? "true" : undefined}
          ><span /></button>
        ))}
      </div>
    </section>
  );
}

function AuthScreen({ onAuthenticated, request }: { onAuthenticated: (isNewAccount: boolean) => void; request: NexusApiRequest }) {
  const [mode, setMode] = useState<"signup" | "login">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await request(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Unable to open the archive.");
        return;
      }
      onAuthenticated(mode === "signup");
    } catch {
      setError("The local timeline vault could not be reached. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-ambient auth-ambient-one" />
      <div className="auth-ambient auth-ambient-two" />
      <section className="auth-intro">
        <AuthPosterWall />
        <div className="auth-start">
          <div className="brand-lockup">
            <div className="brand-mark"><span>D</span></div>
            <div><strong>DOOM FLIX</strong><small>WATCH PROTOCOL</small></div>
          </div>
          <DeveloperCarousel placement="auth" />
        </div>
        <div className="auth-copy">
          <p className="eyebrow"><Radio size={14} /> MISSION // DOOMSDAY</p>
          <h1>Every story.<br /><em>In the right order.</em></h1>
          <p>Navigate the MCU and legacy mutant timeline without crossing a spoiler boundary. Your progress is sealed to your operator profile.</p>
          <div className="auth-readouts">
            <span><b>03</b> timelines</span>
            <span><b>01</b> nexus event</span>
            <span><b>∞</b> possibilities</span>
          </div>
        </div>
        <div className="auth-quote">“Part of the journey is the end.” <span>— T. STARK</span></div>
      </section>

      <section className="auth-panel-wrap">
        <div className="auth-panel glass-panel">
          <div className="panel-corners" />
          <p className="eyebrow"><Fingerprint size={15} /> OPERATOR IDENTIFICATION</p>
          <h2>{mode === "signup" ? "Create your archive" : "Resume your mission"}</h2>
          <p className="muted">{mode === "signup" ? "One local profile. No email or external identity required." : "Enter your stored operator credentials."}</p>
          <div className="auth-switch">
            <span className={`auth-switch-track ${mode}`} aria-hidden="true" />
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button>
            <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
          </div>
          <form onSubmit={submit}>
            <label>Operator name<input name="username" autoComplete="username" placeholder="e.g. watcher_616" required minLength={3} maxLength={24} /></label>
            <label>Access key<span className="password-field"><input name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="Enter password" required minLength={4} maxLength={72} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
            {error && <div className="form-error"><Zap size={14} /> {error}</div>}
            <button className="primary-action" disabled={busy} type="submit">
              {busy ? "Establishing link…" : mode === "signup" ? "Initialize profile" : "Enter Doom Flix"}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>
          <p className="auth-mode-link">
            {mode === "login" ? "New to Doom Flix?" : "Already have an account?"}
            <button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
          <div className="security-note"><ShieldCheck size={15} /><span>Password protected. Progress stored in the local timeline vault.</span></div>
        </div>
      </section>
    </main>
  );
}

function getStats(items: ContentItem[], watched: Set<string>, includeOptional = false, percentByRuntime = false) {
  const trackedItems = includeOptional ? items : items.filter((item) => item.required);
  const totalUnits = trackedItems.reduce((sum, item) => sum + itemUnits(item), 0);
  let watchedUnits = 0;
  let remainingRuntime = 0;
  let watchedRuntime = 0;
  let totalEpisodes = 0;
  let watchedEpisodes = 0;

  for (const item of trackedItems) {
    if (item.kind === "series") {
      for (const episode of item.episodes ?? []) {
        totalEpisodes += 1;
        if (watched.has(progressKey(item.id, episode.id))) {
          watchedUnits += 1;
          watchedEpisodes += 1;
          watchedRuntime += episode.runtimeSec;
        } else {
          remainingRuntime += episode.runtimeSec;
        }
      }
    } else if (watched.has(progressKey(item.id))) {
      watchedUnits += 1;
      watchedRuntime += item.runtimeSec;
    } else {
      remainingRuntime += item.runtimeSec;
    }
  }

  const movies = trackedItems.filter((item) => item.kind === "movie");
  const watchedMovies = movies.filter((item) => itemComplete(item, watched)).length;
  const seriesItems = trackedItems.filter((item) => item.kind === "series");
  const watchedSeries = seriesItems.filter((item) => itemComplete(item, watched)).length;
  const specials = trackedItems.filter((item) => item.kind === "special");
  const watchedSpecials = specials.filter((item) => itemComplete(item, watched)).length;
  const totalRuntime = watchedRuntime + remainingRuntime;
  const progressRatio = percentByRuntime
    ? (totalRuntime ? watchedRuntime / totalRuntime : 0)
    : (totalUnits ? watchedUnits / totalUnits : 0);

  return {
    percent: totalUnits ? (watchedUnits === totalUnits ? 100 : Math.min(99, Math.round(progressRatio * 100))) : 0,
    totalUnits,
    watchedUnits,
    remainingRuntime,
    watchedRuntime,
    movies: movies.length,
    watchedMovies,
    series: seriesItems.length,
    watchedSeries,
    specials: specials.length,
    watchedSpecials,
    totalEpisodes,
    watchedEpisodes,
    pendingRuntime: trackedItems.some((item) => item.dataPending),
  };
}

function toWatchedSet(progress: ProgressRecord[]) {
  return new Set(progress.map((record) => progressKey(record.contentId, record.episode)));
}

function universeLabel(universe: Universe) {
  return universe === "mcu" ? "MCU" : universe === "xmen" ? "X-Men" : "Street-Level Saga";
}

/** Titles that flip from locked to unlocked once `item` is marked watched — for the "new transmission unlocked" toast. */
function detectNewlyUnlocked(item: ContentItem, oldWatched: Set<string>, newWatched: Set<string>) {
  return CONTENT.filter((candidate) => candidate.id !== item.id && !isUnlocked(candidate, oldWatched) && isUnlocked(candidate, newWatched));
}

/** Phase/universe/Doomsday completions that flip to true once `item` is marked watched — for the milestone celebration. */
function detectMilestones(item: ContentItem, oldWatched: Set<string>, newWatched: Set<string>): DelightToastInput[] {
  const milestones: DelightToastInput[] = [];
  const justCompleted = (items: ContentItem[]) => items.length > 0 && !items.every((candidate) => itemComplete(candidate, oldWatched)) && items.every((candidate) => itemComplete(candidate, newWatched));

  if (item.universe === "mcu") {
    const phaseItems = MCU_CONTENT.filter((candidate) => candidate.phase === item.phase && candidate.required);
    if (justCompleted(phaseItems)) {
      milestones.push({ kind: "milestone", title: `${item.phase} complete`, detail: "Every required entry in this phase is watched." });
    }
  }

  const universeItems = UNIVERSE_CONTENT[item.universe].filter((candidate) => candidate.required);
  if (justCompleted(universeItems)) {
    milestones.push({ kind: "milestone", title: `${universeLabel(item.universe)} complete`, detail: "Every required entry in this archive is watched." });
  }

  if (item.universe !== "street") {
    const doomsdayItems = [...MCU_CONTENT, ...XMEN_CONTENT].filter((candidate) => candidate.required);
    if (justCompleted(doomsdayItems)) {
      milestones.push({ kind: "milestone", title: "Doomsday protocol complete", detail: "You are ready for Avengers: Doomsday." });
    }
  }

  return milestones;
}

function CheckpointCounts({ watched, total }: { watched: number; total: number }) {
  return (
    <dl className="checkpoint-counts" aria-label={`${watched} items watched, ${Math.max(0, total - watched)} items remaining`}>
      <div className="watched-count">
        <dt><Check size={13} /> Watched</dt>
        <dd>{watched}</dd>
      </div>
      <div className="remaining-count">
        <dt><Clock3 size={13} /> Remaining</dt>
        <dd>{Math.max(0, total - watched)}</dd>
      </div>
    </dl>
  );
}

function WatchSource({
  item,
  url,
  loaded,
  unlocked,
  placement,
}: {
  item: ContentItem;
  url?: string;
  loaded: boolean;
  unlocked: boolean;
  placement: "card" | "drawer";
}) {
  const className = `watch-source ${placement}`;
  if (!loaded) return <span className={`${className} unavailable`}><Link2Off size={14} /> Loading watch link…</span>;
  if (!url) return <span className={`${className} unavailable`}><Link2Off size={14} /> Watch link unavailable</span>;
  if (!unlocked) return <span className={`${className} locked`}><LockKeyhole size={14} /> Watch link unlocks after prerequisites</span>;
  return (
    <a className={`${className} available`} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Watch ${item.title} on an approved provider`}>
      <Play size={14} /> Watch {item.kind === "series" ? "series" : item.kind} <ExternalLink size={13} />
    </a>
  );
}


function TimelineCard({
  item,
  index,
  watched,
  busy,
  onOpen,
  onOpenPrerequisite,
  onToggle,
  watchUrl,
  watchLinksLoaded,
}: {
  item: ContentItem;
  index: number;
  watched: Set<string>;
  busy: boolean;
  onOpen: () => void;
  onOpenPrerequisite: (item: ContentItem) => void;
  onToggle: (item: ContentItem, episode: number, value: boolean) => void;
  watchUrl?: string;
  watchLinksLoaded: boolean;
}) {
  const complete = itemComplete(item, watched);
  const unlocked = isUnlocked(item, watched);
  const reason = unlockReason(item, watched);
  const prerequisite = missingPrerequisite(item, watched);
  const episodeWatched = item.episodes?.filter((episode) => watched.has(progressKey(item.id, episode.id))).length ?? 0;
  const tiltRef = usePointerTilt<HTMLButtonElement>(5);

  return (
    <article
      id={`timeline-item-${item.id}`}
      className={`timeline-card ${item.universe} ${complete ? "is-complete" : ""} ${!unlocked ? "is-locked" : ""} ${!item.required ? "is-optional" : ""}`}
      style={{ "--tint": POSTER_TINTS[item.id] ?? DEFAULT_TINT } as React.CSSProperties}
    >
      <button ref={tiltRef} className="card-visual" onClick={onOpen} aria-label={`Open ${item.title} details`}>
        <Image src={posterUrl(item)} alt={`${item.title} poster`} fill sizes="(max-width: 640px) 84px, 112px" />
        <div className="card-scrim" />
        <div className="card-sheen" aria-hidden="true" />
        <span className="sequence-number">{String(index + 1).padStart(2, "0")}</span>
        {!unlocked && <span className="poster-lock" aria-hidden="true"><LockKeyhole size={18} /></span>}
        {complete && <div className="complete-stamp" aria-hidden="true"><Check size={17} strokeWidth={3} /></div>}
      </button>
      <div className="card-copy">
        <div className="card-topline">
          <span className={`type-badge ${item.required ? "required" : "optional"}`}>{item.required ? "Required" : "Optional · Safe to skip"}</span>
          {item.recommendation && <span className="goated-badge"><Star size={12} fill="currentColor" /> DEV PICK</span>}
        </div>
        <div className="card-meta"><span>{dateLabel(item.releaseDate)}</span><i /><span>{item.kind === "series" ? `${item.episodes?.length ?? 0} episodes` : formatRuntime(item.runtimeSec).replace(" 00s", "")}</span></div>
        <h3>{item.title}</h3>
        <p className="card-phase">{item.phase}</p>
        <p className="card-summary">{item.summary}</p>
        <div className={`card-availability ${unlocked ? "ready" : "locked"}`} aria-label={unlocked ? `${item.title} is ready to watch` : `Locked: ${reason}`}>
          <span>{unlocked ? <Check size={14} /> : <LockKeyhole size={14} />}{unlocked ? "Ready to watch" : "Locked"}</span>
          {!unlocked && prerequisite && <button title={`Open ${prerequisite.title}`} onClick={() => onOpenPrerequisite(prerequisite)}><span>Open {prerequisite.title}</span><ChevronRight size={14} /></button>}
        </div>
        {!item.required && <p className="optional-note">Optional entry · excluded from Doomsday readiness</p>}
        <WatchSource item={item} url={watchUrl} loaded={watchLinksLoaded} unlocked={unlocked} placement="card" />
        {item.kind === "series" ? (
          <button className="card-action" onClick={onOpen}>
            <span>{complete ? "Season complete" : `${episodeWatched}/${item.episodes?.length ?? 0} episodes`}</span><ChevronRight size={16} />
          </button>
        ) : (
          <button className="card-action" disabled={!unlocked || busy} onClick={() => onToggle(item, -1, !complete)}>
            <span>{busy ? "Syncing…" : complete ? "Watched" : unlocked ? "Mark watched" : "Complete prerequisite"}</span>{complete ? <Check size={16} /> : unlocked ? <Play size={15} /> : <LockKeyhole size={15} />}
          </button>
        )}
      </div>
    </article>
  );
}

function PrerequisiteChain({
  item,
  watched,
  onOpenPrerequisite,
}: {
  item: ContentItem;
  watched: Set<string>;
  onOpenPrerequisite: (item: ContentItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLLIElement>(null);
  const chain = useMemo(() => getPrerequisiteChain(item), [item]);
  const prerequisites = chain.slice(0, -1);
  const next = missingPrerequisite(item, watched);
  const selectedUnlocked = isUnlocked(item, watched);
  const completedPrerequisites = prerequisites.filter((candidate) => itemComplete(candidate, watched)).length;
  const nextIndex = next ? chain.findIndex((candidate) => candidate.id === next.id) : -1;
  const previewStart = nextIndex >= 0 ? nextIndex : Math.max(0, chain.length - 3);
  const previewRows = chain.slice(previewStart, previewStart + 3);
  const visibleRows = expanded ? chain : previewRows;
  const canExpand = previewRows.length !== chain.length;
  const focusId = chain[previewStart]?.id;
  const listId = `viewing-path-${item.id}`;

  useEffect(() => {
    if (!expanded) return;
    const frame = window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      const anchor = focusRef.current;
      if (!container || !anchor) return;
      const offset = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += offset - 8;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, item.id]);

  if (!prerequisites.length) {
    return (
      <section className="viewing-path compact complete" aria-label="Viewing path">
        <Check size={18} />
        <div><strong>No prerequisites</strong><p>No prerequisite viewing is required for this title.</p></div>
      </section>
    );
  }

  return (
    <section className={`viewing-path ${next ? "locked" : "complete"}`} aria-labelledby={`${listId}-title`}>
      <header className="viewing-path-header">
        <div>
          <span>VIEWING PATH</span>
          <strong id={`${listId}-title`}>{next ? "Prerequisites remaining" : "Prerequisites complete"}</strong>
          <p>{next ? `Start with ${next.title}.` : "Everything required for this title has been watched."}</p>
        </div>
        <span>{completedPrerequisites}/{prerequisites.length}</span>
      </header>

      <div ref={scrollRef} className={`viewing-path-scroll ${expanded ? "expanded" : "collapsed"}`}>
        <ol id={listId} className="viewing-path-list">
          {visibleRows.map((chainItem) => {
            const complete = itemComplete(chainItem, watched);
            const selected = chainItem.id === item.id;
            const watchNext = chainItem.id === next?.id;
            const scheduled = selected && !next && !selectedUnlocked;
            const tone = complete || (selected && selectedUnlocked) ? "complete" : scheduled ? "scheduled" : "pending";
            const watchedEpisodes = chainItem.kind === "series"
              ? chainItem.episodes?.filter((episode) => watched.has(progressKey(chainItem.id, episode.id))).length ?? 0
              : 0;
            const status = selected
              ? complete ? "Watched" : selectedUnlocked ? "Ready to watch" : scheduled ? "Scheduled" : "Locked"
              : complete ? "Watched" : watchNext ? "Watch next" : "Still required";
            const rowContent = (
              <>
                <span className="viewing-path-marker">
                  {tone === "complete" ? <Check size={14} /> : watchNext ? <Play size={13} /> : scheduled ? <Clock3 size={14} /> : <LockKeyhole size={13} />}
                </span>
                <span className="viewing-path-copy">
                  <strong>{chainItem.title}</strong>
                  <small>{chainItem.kind === "series" ? `${watchedEpisodes}/${chainItem.episodes?.length ?? 0} episodes` : chainItem.kind}{selected ? " · Your selection" : ""}</small>
                </span>
                <span className="viewing-path-status">{status}</span>
                {!selected && <ChevronRight size={15} />}
              </>
            );

            return (
              <li
                key={chainItem.id}
                ref={expanded && chainItem.id === focusId ? focusRef : undefined}
                className={`${tone} ${watchNext ? "watch-next" : ""} ${selected ? "selected" : ""}`}
                aria-current={watchNext ? "step" : undefined}
              >
                {selected ? <div className="viewing-path-row">{rowContent}</div> : (
                  <button type="button" className="viewing-path-row" onClick={() => onOpenPrerequisite(chainItem)} aria-label={`${status}: open ${chainItem.title}`}>
                    {rowContent}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {canExpand && (
        <button
          type="button"
          className="viewing-path-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {expanded ? "Collapse path" : `Show full path · ${chain.length} titles`}
        </button>
      )}
    </section>
  );
}

function DetailDrawer({
  item,
  watched,
  busyKey,
  onClose,
  onOpenPrerequisite,
  onToggle,
  watchUrl,
  watchLinksLoaded,
}: {
  item: ContentItem;
  watched: Set<string>;
  busyKey: string | null;
  onClose: () => void;
  onOpenPrerequisite: (item: ContentItem) => void;
  onToggle: (item: ContentItem, episode: number, value: boolean) => void;
  watchUrl?: string;
  watchLinksLoaded: boolean;
}) {
  const complete = itemComplete(item, watched);
  const unlocked = isUnlocked(item, watched);
  const reason = unlockReason(item, watched);
  const prerequisite = missingPrerequisite(item, watched);
  const dialogRef = useDialogBehavior(onClose);
  const titleId = `details-${item.id}-title`;
  const episodeUnlocked = (index: number, episode: NonNullable<typeof item.episodes>[number]) => {
    const priorDone = index === 0 || watched.has(progressKey(item.id, episode.id - 1));
    return unlocked && priorDone;
  };
  const nextEpisode = item.kind === "series" && !item.dataPending
    ? (item.episodes ?? []).find((episode, index) => !watched.has(progressKey(item.id, episode.id)) && episodeUnlocked(index, episode))
    : undefined;
  return (
    <div className="drawer-shell">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Close details" />
      <aside ref={dialogRef} className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="drawer-hero">
          <Image src={backdropUrl(item)} alt="" fill sizes="min(560px, 100vw)" />
          <div className="drawer-hero-scrim" />
          <button className="close-button" onClick={onClose} aria-label="Close details"><X size={19} /></button>
          <div className="drawer-title">
            <div className="card-topline"><span className={`type-badge ${item.required ? "required" : "optional"}`}>{item.required ? "Required protocol" : "Optional • Safe to skip"}</span></div>
            <p className="eyebrow">{item.phase}{" // "}{dateLabel(item.releaseDate)}</p>
            <h2 id={titleId}>{item.title}</h2>
          </div>
        </div>
        <div className="drawer-content">
          {!item.required && <div className="optional-explainer"><Star size={18} /><div><strong>OPTIONAL TRANSMISSION</strong><p>This entry is available for completionists, but skipping it will not lock any required movie or series.</p></div></div>}
          {item.recommendation && <div className="developer-pick"><Star size={19} fill="currentColor" /><div><strong>DEVELOPER&apos;S RECOMMENDATION</strong><p>{item.recommendation}</p></div></div>}
          <PrerequisiteChain item={item} watched={watched} onOpenPrerequisite={onOpenPrerequisite} />
          {!prerequisite && !unlocked && <div className="scheduled-alert"><Clock3 size={18} /><div><strong>SCHEDULED RELEASE</strong><p>{reason}</p></div></div>}
          <p className="drawer-summary">{item.summary}</p>
          <div className="lore-brief"><span><Orbit size={16} /> CONTINUITY BRIEF</span><p>{item.lore}</p></div>

          {item.kind === "series" && (
            <section className="episode-section">
              <div className="section-heading"><div><p className="eyebrow">EPISODE MATRIX</p><h3>Season progress</h3></div><span>{item.episodes?.filter((episode) => watched.has(progressKey(item.id, episode.id))).length ?? 0}/{item.episodes?.length ?? 0}</span></div>
              <div className="episode-list">
                {(item.episodes ?? []).map((episode, index) => {
                  const checked = watched.has(progressKey(item.id, episode.id));
                  const rowUnlocked = episodeUnlocked(index, episode);
                  const key = progressKey(item.id, episode.id);
                  return (
                    <button key={episode.id} className={`episode-row ${checked ? "checked" : ""}`} disabled={!rowUnlocked || busyKey === key || item.dataPending} onClick={() => onToggle(item, episode.id, !checked)}>
                      <span className="episode-check">{checked ? <Check size={15} /> : rowUnlocked && !item.dataPending ? <Play size={13} /> : <LockKeyhole size={13} />}</span>
                      <span className="episode-number">E{String(episode.id).padStart(2, "0")}</span>
                      <span className="episode-name">{item.dataPending ? `Episode ${episode.id} — metadata pending` : episode.title}</span>
                      <span className="episode-runtime">{episode.runtimeSec ? formatRuntime(episode.runtimeSec).replace("00h ", "").replace(" 00s", "") : "TBD"}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
        <div className={`drawer-command-bar ${item.kind === "series" && !nextEpisode ? "single" : ""}`}>
          <WatchSource item={item} url={watchUrl} loaded={watchLinksLoaded} unlocked={unlocked} placement="drawer" />
          {item.kind !== "series" && (
            <button className="primary-action drawer-action" disabled={!unlocked || busyKey === progressKey(item.id)} onClick={() => onToggle(item, -1, !complete)}>
              {complete ? "Remove watched status" : unlocked ? "Mark as watched" : "Complete prerequisite first"}{complete ? <X size={17} /> : <Check size={17} />}
            </button>
          )}
          {item.kind === "series" && nextEpisode && (
            <button className="primary-action drawer-action" disabled={busyKey === progressKey(item.id, nextEpisode.id)} onClick={() => onToggle(item, nextEpisode.id, true)}>
              Mark E{String(nextEpisode.id).padStart(2, "0")} watched <Check size={17} />
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function UnwatchConfirmation({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingUnwatch;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useDialogBehavior(onCancel);
  const affectedTitles = [...new Set(pending.newerRecords.map((record) => CONTENT_BY_ID.get(record.contentId)?.title).filter(Boolean))];
  const checkpointLabel = pending.episode > 0 ? `${pending.item.title}, episode ${pending.episode}` : pending.item.title;

  return (
    <div className="confirmation-shell">
      <button className="confirmation-backdrop" onClick={onCancel} aria-label="Cancel removing watched status" />
      <section ref={dialogRef} className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unwatch-title" aria-describedby="unwatch-description" tabIndex={-1}>
        <div className="confirmation-icon"><Zap size={22} /></div>
        <p className="eyebrow">TIMELINE SAFEGUARD</p>
        <h2 id="unwatch-title">Remove an earlier watched item?</h2>
        <p id="unwatch-description">You watched {pending.newerRecords.length} newer checkpoint{pending.newerRecords.length === 1 ? "" : "s"} after <strong>{checkpointLabel}</strong>. Removing it may also clear later progress that depends on it.</p>
        {affectedTitles.length > 0 && <p className="confirmation-affected">Newer progress includes {affectedTitles.slice(0, 3).join(", ")}{affectedTitles.length > 3 ? ` and ${affectedTitles.length - 3} more` : ""}.</p>}
        <div className="confirmation-actions">
          <button className="secondary-action" onClick={onCancel}>Keep watched</button>
          <button className="danger-action" onClick={onConfirm}>Yes, remove it</button>
        </div>
      </section>
    </div>
  );
}


export default function MarvelNexus({ request = browserApiRequest }: { request?: NexusApiRequest }) {
  const [user, setUser] = useState<User | null>(null);
  const [progress, setProgress] = useState<ProgressRecord[]>([]);
  const [databaseMode, setDatabaseMode] = useState("TIMELINE VAULT");
  const [loading, setLoading] = useState(true);
  const [universe, setUniverse] = useState<Universe>("mcu");
  const [requirementFilter, setRequirementFilter] = useState<RequirementFilter>("all");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [unwatchedOnly, setUnwatchedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<ContentItem | null>(null);
  const [loreOpen, setLoreOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [delightToasts, setDelightToasts] = useState<DelightToast[]>([]);
  const delightIdRef = useRef(0);
  const [loadError, setLoadError] = useState("");
  const [pendingUnwatch, setPendingUnwatch] = useState<PendingUnwatch | null>(null);
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  const [watchCatalogue, setWatchCatalogue] = useState<WatchLinkCatalogue & { loaded: boolean }>({ links: new Map(), issues: [], loaded: false });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [nextCardVisible, setNextCardVisible] = useState(true);
  const scrollToken = useRef(0);
  const tabRefs = useRef<Record<Universe, HTMLButtonElement | null>>({ mcu: null, xmen: null, street: null });
  const searchInputRef = useRef<HTMLInputElement>(null);
  useGlassSpotlight();

  async function loadProgress() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await request("/api/progress", { cache: "no-store" });
      if (response.status === 401) {
        setUser(null);
        setProgress([]);
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The local timeline vault is unavailable.");
      setUser(payload.user);
      setProgress(payload.progress ?? []);
      setDatabaseMode(payload.databaseMode ?? "TIMELINE VAULT");
    } catch {
      setLoadError("The local timeline vault is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAuthenticated(isNewAccount: boolean) {
    await loadProgress();
    if (isNewAccount) setLoreOpen(true);
  }

  useEffect(() => {
    const controller = new AbortController();
    request("/api/progress", { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (response.status === 401) {
          setUser(null);
          setProgress([]);
        } else {
          if (!response.ok) throw new Error(payload.error ?? "The local timeline vault is unavailable.");
          setUser(payload.user);
          setProgress(payload.progress ?? []);
          setDatabaseMode(payload.databaseMode ?? "TIMELINE VAULT");
        }
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError("The local timeline vault is unavailable.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    const controller = new AbortController();
    const csvUrl = new URL("./watch-links.csv", document.baseURI);
    fetch(csvUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Watch-link CSV returned ${response.status}.`);
        return response.text();
      })
      .then((source) => setWatchCatalogue({ ...parseWatchLinksCsv(source, CONTENT.map((item) => item.title)), loaded: true }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setWatchCatalogue({ links: new Map(), issues: [error instanceof Error ? error.message : "Watch-link CSV could not be loaded."], loaded: true });
      });
    return () => controller.abort();
  }, []);

  const watched = useMemo(() => new Set(progress.map((record) => progressKey(record.contentId, record.episode))), [progress]);
  const items = universe === "mcu" ? MCU_CONTENT : universe === "xmen" ? XMEN_CONTENT : STREET_CONTENT;
  const itemIndexById = useMemo(() => new Map(items.map((entry, index) => [entry.id, index])), [items]);
  const trackStats = useMemo(() => getStats(items, watched, true, true), [items, watched]);
  const doomsdayStats = useMemo(() => getStats([...MCU_CONTENT, ...XMEN_CONTENT], watched, false, true), [watched]);
  const visibleItems = items.filter((item) => {
    if (requirementFilter === "doomsday") return item.required && item.universe !== "street";
    if (requirementFilter === "optional") return !item.required;
    return true;
  }).filter((item) => {
    if (formatFilter !== "all") return item.kind === formatFilter;
    return true;
  }).filter((item) => {
    if (unwatchedOnly) return !itemComplete(item, watched);
    return true;
  }).filter((item) => item.title.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase()));
  const nextRequired = items.find((item) => item.required && !itemComplete(item, watched));
  const nextUnlocked = items.find((item) => item.required && !itemComplete(item, watched) && isUnlocked(item, watched));
  const nextByUniverse = useMemo<Partial<Record<Universe, ContentItem>>>(() => ({
    mcu: MCU_CONTENT.find((candidate) => candidate.required && !itemComplete(candidate, watched)),
    xmen: XMEN_CONTENT.find((candidate) => candidate.required && !itemComplete(candidate, watched)),
    street: STREET_CONTENT.find((candidate) => candidate.required && !itemComplete(candidate, watched)),
  }), [watched]);
  const inProgressSeries = useMemo(() => CONTENT.filter((candidate) => {
    if (candidate.kind !== "series") return false;
    const total = candidate.episodes?.length ?? 0;
    const done = candidate.episodes?.filter((episode) => watched.has(progressKey(candidate.id, episode.id))).length ?? 0;
    return done > 0 && done < total;
  }).slice(0, 6), [watched]);

  function pushDelightToast(toast: DelightToastInput, ttlMs = 5600) {
    delightIdRef.current += 1;
    const id = delightIdRef.current;
    setDelightToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => dismissDelightToast(id), ttlMs);
  }

  function dismissDelightToast(id: number) {
    setDelightToasts((current) => current.filter((toast) => toast.id !== id));
  }

  async function persistToggle(item: ContentItem, episode: number, value: boolean) {
    const key = progressKey(item.id, episode);
    setBusyKey(key);
    setNotice("");
    try {
      const response = await request("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId: item.id, episode, watched: value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Timeline update rejected.");
      const newProgress: ProgressRecord[] = payload.progress ?? [];
      setProgress(newProgress);

      if (value) {
        const newWatched = toWatchedSet(newProgress);
        const unitSeconds = item.kind === "series" && episode > 0
          ? item.episodes?.find((candidate) => candidate.id === episode)?.runtimeSec ?? 0
          : item.runtimeSec;
        if (unitSeconds > 0) {
          const countsTowardDoomsday = item.required && item.universe !== "street";
          const amount = formatRuntime(unitSeconds).replace(" 00s", "");
          pushDelightToast({ kind: "checkpoint", title: "Checkpoint secured", detail: countsTowardDoomsday ? `${amount} closer to Doomsday` : `${amount} logged in your archive` });
        }
        for (const revealed of detectNewlyUnlocked(item, watched, newWatched).slice(0, 3)) {
          pushDelightToast({ kind: "unlock", item: revealed }, 6800);
        }
        for (const milestone of detectMilestones(item, watched, newWatched)) {
          pushDelightToast(milestone, 7200);
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Timeline update rejected.");
      window.setTimeout(() => setNotice(""), 4200);
    } finally {
      setBusyKey(null);
    }
  }

  function toggle(item: ContentItem, episode: number, value: boolean) {
    if (!value) {
      const recordIndex = progress.findIndex((record) => record.contentId === item.id && record.episode === episode);
      if (recordIndex >= 0 && recordIndex < progress.length - 1) {
        setPendingUnwatch({ item, episode, newerRecords: progress.slice(recordIndex + 1) });
        return;
      }
    }
    void persistToggle(item, episode, value);
  }

  function confirmUnwatch() {
    if (!pendingUnwatch) return;
    const { item, episode } = pendingUnwatch;
    setPendingUnwatch(null);
    void persistToggle(item, episode, false);
  }

  async function logout() {
    try {
      const response = await request("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      setUser(null);
      setProgress([]);
    } catch {
      setNotice("Could not close the local session. Try again.");
    }
  }

  useEffect(() => {
    if (!scrollRequest) return;
    const frame = window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const phoneLayout = window.matchMedia("(max-width: 580px)").matches;
      document.getElementById(`timeline-item-${scrollRequest.contentId}`)?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: phoneLayout ? "start" : "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollRequest, universe]);

  useEffect(() => {
    if (!user) return undefined;
    let observer: IntersectionObserver | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (!nextRequired) {
        setNextCardVisible(true);
        return;
      }
      const target = document.getElementById(`timeline-item-${nextRequired.id}`);
      if (!target) {
        setNextCardVisible(true);
        return;
      }
      observer = new IntersectionObserver(([entry]) => setNextCardVisible(entry.isIntersecting), { threshold: 0.15 });
      observer.observe(target);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [user, nextRequired, universe, requirementFilter, formatFilter, unwatchedOnly, searchQuery]);

  const selectUniverse = useCallback((nextUniverse: Universe) => {
    setUniverse(nextUniverse);
    setRequirementFilter("all");
    setFormatFilter("all");
    setUnwatchedOnly(false);
    setSearchQuery("");
  }, []);

  function openArchiveItem(item: ContentItem) {
    selectUniverse(item.universe);
    setSelected(item);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: Universe) {
    const order: Universe[] = ["mcu", "xmen", "street"];
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = order[(order.indexOf(current) + direction + order.length) % order.length];
    selectUniverse(next);
    tabRefs.current[next]?.focus();
  }

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      const anotherDialogOpen = Boolean(selected || loreOpen || pendingUnwatch);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (anotherDialogOpen) return;
        setPaletteOpen((current) => !current);
        return;
      }
      if (paletteOpen || anotherDialogOpen) return;
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === "1") {
        selectUniverse("mcu");
      } else if (event.key === "2") {
        selectUniverse("xmen");
      } else if (event.key === "3") {
        selectUniverse("street");
      } else if (event.key.toLowerCase() === "n") {
        if (nextRequired) setSelected(nextRequired);
      } else if (event.key.toLowerCase() === "l") {
        setLoreOpen(true);
      } else if (event.key === "?") {
        setPaletteOpen(true);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, selected, loreOpen, pendingUnwatch, nextRequired, selectUniverse]);

  if (loading) return <LoadingScreen />;
  if (loadError) return <main className="loading-screen error-screen"><Zap size={34} /><p className="eyebrow">ARCHIVE LINK INTERRUPTED</p><h1>{loadError}</h1><button className="primary-action" onClick={loadProgress}>Retry connection <ArrowRight size={17} /></button></main>;
  if (!user) return <AuthScreen onAuthenticated={handleAuthenticated} request={request} />;

  const activeHero = nextUnlocked ?? nextRequired ?? items.at(-1)!;
  const doomsdayComplete = doomsdayStats.watchedUnits === doomsdayStats.totalUnits;
  const daysUntilDoomsday = Math.max(0, Math.ceil((DOOMSDAY.getTime() - Date.now()) / 86400000));

  return (
    <main className="app-shell" data-universe={universe}>
      <div className="ambient-grid" />
      <header className="topbar">
        <div className="brand-lockup compact">
          <div className="brand-mark"><span>D</span></div>
          <div><strong>DOOM FLIX</strong><small>WATCH PROTOCOL</small></div>
        </div>
        <nav>
          <button className="nav-active"><Layers3 size={15} /> Timeline</button>
          <button onClick={() => setLoreOpen(true)}><Orbit size={15} /> Lore brief</button>
          <span className="topbar-divider" aria-hidden="true" />
          <button className="topbar-tab" aria-pressed={universe === "mcu"} onClick={() => selectUniverse("mcu")}>MCU</button>
          <button className="topbar-tab" aria-pressed={universe === "xmen"} onClick={() => selectUniverse("xmen")}>X-Men</button>
          <button className="topbar-tab" aria-pressed={universe === "street"} onClick={() => selectUniverse("street")}>Street</button>
        </nav>
        <div className="operator-block">
          <span className="vault-status"><i /> {databaseMode}</span>
          <div className="operator-name"><CircleUserRound size={18} /><div><small>OPERATOR</small><strong>{user.username}</strong></div></div>
          <button className="icon-button" onClick={() => setPaletteOpen(true)} aria-label="Search the archive (Ctrl K)"><Search size={17} /></button>
          <button className="mobile-lore-action" onClick={() => setLoreOpen(true)} aria-label="Open lore brief"><Orbit size={17} /><span>Lore</span></button>
          <button className="icon-button" onClick={logout} aria-label="Log out"><LogOut size={17} /></button>
        </div>
      </header>

      <DeveloperCarousel placement="dashboard" />

      <section className="mission-stage">
        <div className="mission-stage-backdrop"><Image src={backdropUrl(activeHero)} alt="" fill priority sizes="100vw" /><div /></div>
        <section className="mission-hero">
        <div className="hero-content">
          <div className="hero-copy">
            <p className="eyebrow"><span className="pulse-dot" /> ACTIVE MISSION // {universe === "mcu" ? "EARTH-616" : universe === "xmen" ? "LEGACY MUTANT" : "STREET-LEVEL"}</p>
            <h1>Road to <em>Doomsday</em></h1>
            <p>{universe === "xmen" ? "Follow the mutant release order; Deadpool and Deadpool 2 use focused exceptions, and both Deadpool 2 and Deadpool & Wolverine are required for Doomsday." : universe === "street" ? "Follow each hero's seasons in order and meet the explicit crossover gates; unrelated New York stories can be watched independently." : "Complete every required transmission in release order. The timeline will protect you from what comes next."}</p>
          </div>
          <DoomsdayCountdown />
        </div>
        </section>

        <section className="dashboard-content dashboard-summary">
        <section className="progress-overview global-status-row">
          <div className="status-primary doomsday-progress glass-panel">
            <ProgressReactor value={doomsdayStats.percent} tone="global" />
            <div className="status-copy"><div className="status-label"><p className="eyebrow">UNIVERSAL DOOMSDAY READINESS</p><span>GLOBAL</span></div><h2>{doomsdayComplete ? "Doomsday protocol complete" : "Mission in progress"}</h2><p>{doomsdayStats.movies} movies + {doomsdayStats.specials} specials + {doomsdayStats.totalEpisodes} episodes · required checkpoints</p><CheckpointCounts watched={doomsdayStats.watchedUnits} total={doomsdayStats.totalUnits} /></div>
          </div>
          <div className="metric-card runtime-card doomsday-runtime glass-panel"><Clock3 size={22} /><div><span className="scope-pill">GLOBAL</span><small>DOOMSDAY WATCH TIME LEFT</small><strong>{formatRuntime(doomsdayStats.remainingRuntime)}</strong><em>MCU + X-MEN REQUIRED ONLY{doomsdayStats.pendingRuntime ? " · PLUS UNRELEASED RUNTIME" : ""}</em>
            <PacePlanner remainingSeconds={doomsdayStats.remainingRuntime} daysLeft={daysUntilDoomsday} complete={doomsdayComplete} />
          </div></div>
        </section>

        <div className="universe-switch" role="tablist" aria-label="Universe selector">
          <button ref={(node) => { tabRefs.current.mcu = node; }} id="mcu-tab" role="tab" aria-label="MCU timeline" aria-selected={universe === "mcu"} aria-controls="timeline-panel" tabIndex={universe === "mcu" ? 0 : -1} className={universe === "mcu" ? "active" : ""} onKeyDown={(event) => handleTabKeyDown(event, "mcu")} onClick={() => selectUniverse("mcu")}><span className="marvel-word">MARVEL</span><span className="mobile-tab-label">MCU</span><div><strong>MCU TIMELINE</strong><small>EARTH-616 + MULTIVERSE</small></div></button>
          <button ref={(node) => { tabRefs.current.xmen = node; }} id="xmen-tab" role="tab" aria-label="X-Men universe" aria-selected={universe === "xmen"} aria-controls="timeline-panel" tabIndex={universe === "xmen" ? 0 : -1} className={universe === "xmen" ? "active x-active" : ""} onKeyDown={(event) => handleTabKeyDown(event, "xmen")} onClick={() => selectUniverse("xmen")}><span className="x-word">X</span><span className="mobile-tab-label">X-Men</span><div><strong>X-MEN UNIVERSE</strong><small>LEGACY MUTANT TIMELINE</small></div></button>
          <button ref={(node) => { tabRefs.current.street = node; }} id="street-tab" role="tab" aria-label="Street-Level saga" aria-selected={universe === "street"} aria-controls="timeline-panel" tabIndex={universe === "street" ? 0 : -1} className={universe === "street" ? "active street-active" : ""} onKeyDown={(event) => handleTabKeyDown(event, "street")} onClick={() => selectUniverse("street")}><span className="street-word">NYC</span><span className="mobile-tab-label">Street</span><div><strong>STREET-LEVEL SAGA</strong><small>DEFENDERS + NEW YORK LEGACY</small></div></button>
          <span className={`switch-track ${universe}`} />
        </div>

        <section className="status-deck metric-deck local-status-row">
          <div className="status-primary track-status glass-panel">
            <ProgressReactor value={trackStats.percent} tone="local" />
            <div className="status-copy"><p className="eyebrow">CURRENT TAB ARCHIVE</p><h2>{universe === "mcu" ? "MCU completion" : universe === "xmen" ? "X-Men completion" : "Street Saga completion"}</h2><p>{trackStats.movies} movies + {trackStats.specials} specials + {trackStats.totalEpisodes} episodes • optional included</p><CheckpointCounts watched={trackStats.watchedUnits} total={trackStats.totalUnits} /></div>
          </div>
          <div className="counter-grid glass-panel">
            <div className="counter-cell"><Film size={18} /><div><small>MOVIES</small><strong>{trackStats.watchedMovies}<span> / {trackStats.movies}</span></strong></div></div>
            <div className="counter-cell"><Tv size={18} /><div><small>SEASONS</small><strong>{trackStats.watchedSeries}<span> / {trackStats.series}</span></strong></div></div>
            <div className="counter-cell"><Star size={18} /><div><small>SPECIALS</small><strong>{trackStats.watchedSpecials}<span> / {trackStats.specials}</span></strong></div></div>
            <div className="counter-cell"><Layers3 size={18} /><div><small>EPISODES LEFT</small><strong>{trackStats.totalEpisodes - trackStats.watchedEpisodes}</strong></div></div>
          </div>
          <div className={`metric-card runtime-card local-runtime ${universe} glass-panel`}><Clock3 size={19} /><div><small>{universe === "mcu" ? "MCU TIME LEFT" : universe === "xmen" ? "X-MEN TIME LEFT" : "STREET SAGA TIME LEFT"}</small><strong>{formatRuntime(trackStats.remainingRuntime)}</strong><em>LOCAL ARCHIVE • OPTIONAL INCLUDED{trackStats.pendingRuntime ? " • PLUS UNRELEASED RUNTIME" : ""}</em></div></div>
        </section>

        <section className="next-operation glass-panel">
          {nextRequired ? (
            <button className="operation-art" onClick={() => setSelected(nextRequired)} aria-label={`Open ${nextRequired.title}`}>
              <Image src={posterUrl(nextRequired)} alt={`${nextRequired.title} poster`} fill sizes="64px" />
            </button>
          ) : <div className="operation-signal"><span /><Radio size={17} /></div>}
          <div className="operation-copy"><p className="eyebrow">NEXT REQUIRED CHECKPOINT</p><h3>{nextRequired?.title ?? "Current archive complete"}</h3><p>{nextRequired ? (isUnlocked(nextRequired, watched) ? "Cleared for viewing. Continue when ready." : unlockReason(nextRequired, watched)) : doomsdayComplete ? "You are ready for Avengers: Doomsday." : `${universe === "mcu" ? "MCU" : universe === "xmen" ? "X-Men" : "Street-Level"} archive complete. Continue the other required archive to finish Doomsday readiness.`}</p></div>
          {nextRequired && <button onClick={() => setSelected(nextRequired)}>OPEN FILE <ChevronRight size={15} /></button>}
        </section>
        <MultiverseShelf nextByUniverse={nextByUniverse} inProgressSeries={inProgressSeries} watched={watched} onOpenItem={openArchiveItem} />
        </section>
      </section>

      <section className="dashboard-content archive-content">
        <div className="archive-heading">
          <div><p className="eyebrow">ARCHIVE // {universe === "mcu" ? "MARVEL CINEMATIC UNIVERSE" : universe === "xmen" ? "LEGACY MUTANT UNIVERSE" : "NEW YORK STREET-LEVEL CONTINUITY"}</p><h2>{universe === "mcu" ? "The Infinity & Multiverse Sagas" : universe === "xmen" ? "The X-Men Film Timeline" : "The Street-Level Saga"}</h2></div>
          <div className="archive-tools">
            <label className="search-field"><Search size={16} /><span className="sr-only">Search this archive</span><input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search this archive" /></label>
            <div className="filter-groups">
              <div className="filter-group"><span>Mission</span><div className="filter-row" aria-label="Filter by Doomsday necessity">
                {([['all', 'All'], ['doomsday', 'Necessary for Doomsday'], ['optional', 'Optional']] as [RequirementFilter, string][]).map(([value, label]) => <button key={value} aria-pressed={requirementFilter === value} disabled={universe === "street" && value === "doomsday"} title={universe === "street" && value === "doomsday" ? "Street-Level entries do not count toward Doomsday readiness" : undefined} className={requirementFilter === value ? "active" : ""} onClick={() => setRequirementFilter(value)}>{label}</button>)}
              </div></div>
              <div className="filter-group"><span>Format</span><div className="filter-row" aria-label="Filter by format">
                {([['all', 'All'], ['movie', 'Movies'], ['series', 'TV shows'], ['special', 'Specials']] as [FormatFilter, string][]).map(([value, label]) => <button key={value} aria-pressed={formatFilter === value} className={formatFilter === value ? "active" : ""} onClick={() => setFormatFilter(value)}>{label}</button>)}
              </div></div>
              <div className="filter-group"><span>Progress</span><div className="filter-row progress-filter" aria-label="Filter by viewing progress">
                <button aria-pressed={unwatchedOnly} className={unwatchedOnly ? "active" : ""} onClick={() => setUnwatchedOnly((current) => !current)}>Unwatched</button>
              </div></div>
            </div>
          </div>
        </div>

        <section id="timeline-panel" role="tabpanel" aria-labelledby={`${universe}-tab`} className="timeline-grid">
          {visibleItems.map((item, visibleIndex) => (
            <Fragment key={item.id}>
              {(visibleIndex === 0 || visibleItems[visibleIndex - 1].phase !== item.phase) && <div className="era-heading"><span>{item.phase}</span><i /></div>}
              <TimelineCard
                item={item}
                index={itemIndexById.get(item.id) ?? 0}
                watched={watched}
                busy={busyKey === progressKey(item.id)}
                onOpen={() => setSelected(item)}
                onOpenPrerequisite={openArchiveItem}
                onToggle={toggle}
                watchUrl={watchCatalogue.links.get(normalizeWatchTitle(item.title))}
                watchLinksLoaded={watchCatalogue.loaded}
              />
            </Fragment>
          ))}
          {!visibleItems.length && <div className="empty-state"><Search size={28} /><h3>No transmissions found</h3><p>Try another title or clear the active filters.</p><button onClick={() => { setSearchQuery(""); setRequirementFilter("all"); setFormatFilter("all"); setUnwatchedOnly(false); }}>Reset archive view</button></div>}
        </section>
      </section>

      <footer><div className="brand-lockup compact"><div className="brand-mark"><span>D</span></div><div><strong>DOOM FLIX</strong><small>WATCH PROTOCOL</small></div></div><p>Personal viewing archive • Release-order spoiler protection active</p><span><Database size={14} /> {CONTENT.length} transmissions indexed</span></footer>

      {selected && <DetailDrawer key={selected.id} item={selected} watched={watched} busyKey={busyKey} onClose={() => setSelected(null)} onOpenPrerequisite={openArchiveItem} onToggle={toggle} watchUrl={watchCatalogue.links.get(normalizeWatchTitle(selected.title))} watchLinksLoaded={watchCatalogue.loaded} />}
      {loreOpen && (
        <LoreExperience
          watched={watched}
          doomsdayPercent={doomsdayStats.percent}
          remainingSeconds={doomsdayStats.remainingRuntime}
          daysLeft={daysUntilDoomsday}
          nextUp={nextRequired}
          onOpenItem={openArchiveItem}
          onExit={() => setLoreOpen(false)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          watched={watched}
          onOpenItem={openArchiveItem}
          onSelectUniverse={selectUniverse}
          onOpenLore={() => setLoreOpen(true)}
        />
      )}
      {pendingUnwatch && <UnwatchConfirmation pending={pendingUnwatch} onCancel={() => setPendingUnwatch(null)} onConfirm={confirmUnwatch} />}
      {notice && <div className="toast" role="status" aria-live="polite"><Zap size={16} /> {notice}</div>}
      <ToastStack toasts={delightToasts} onDismiss={dismissDelightToast} onOpenItem={openArchiveItem} />
      {nextRequired && !nextCardVisible && !selected && !loreOpen && !paletteOpen && (
        <button
          className="jump-pill"
          onClick={() => {
            scrollToken.current += 1;
            setScrollRequest({ contentId: nextRequired.id, token: scrollToken.current });
          }}
        >
          <ArrowDown size={14} /> Next: <span>{nextRequired.title}</span>
        </button>
      )}
    </main>
  );
}
