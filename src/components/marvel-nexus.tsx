"use client";

import Image from "next/image";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Database,
  Eye,
  EyeOff,
  Film,
  Fingerprint,
  Layers3,
  LockKeyhole,
  LogOut,
  Menu,
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
import { FormEvent, Fragment, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  CONTENT,
  CONTENT_BY_ID,
  MCU_CONTENT,
  STREET_CONTENT,
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

type User = { id: string; username: string };
type ProgressRecord = { contentId: string; episode: number };
type RequirementFilter = "all" | "doomsday" | "optional";
type FormatFilter = "all" | "movie" | "series" | "special";
type PendingUnwatch = { item: ContentItem; episode: number; newerRecords: ProgressRecord[] };
type ScrollRequest = { contentId: string; token: number };

const DOOMSDAY = new Date("2026-12-18T00:00:00");

function posterUrl(item: ContentItem) {
  return `/posters/${item.id}.webp`;
}

function backdropUrl(item: ContentItem) {
  return `/backdrops/${item.id}.webp`;
}

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

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Unable to open the archive.");
        return;
      }
      onAuthenticated();
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
        <div className="brand-lockup">
          <div className="brand-mark"><span>N</span></div>
          <div><strong>NEXUS</strong><small>WATCH PROTOCOL</small></div>
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
            <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create profile</button>
            <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button>
          </div>
          <form onSubmit={submit}>
            <label>Operator name<input name="username" autoComplete="username" placeholder="e.g. watcher_616" required minLength={3} maxLength={24} /></label>
            <label>Access key<span className="password-field"><input name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="Enter password" required minLength={4} maxLength={72} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
            {error && <div className="form-error"><Zap size={14} /> {error}</div>}
            <button className="primary-action" disabled={busy} type="submit">
              {busy ? "Establishing link…" : mode === "signup" ? "Initialize profile" : "Enter the Nexus"}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>
          <div className="security-note"><ShieldCheck size={15} /><span>Password protected. Progress stored in the local timeline vault.</span></div>
        </div>
      </section>
    </main>
  );
}

function Countdown() {
  const countdown = useCountdown();
  return (
    <div className="countdown-block">
      <div className="countdown-heading"><span className="pulse-dot" /> DOOMSDAY ARRIVES</div>
      <div className="countdown-grid">
        {(["days", "hours", "minutes", "seconds"] as const).map((unit) => (
          <div key={unit}><strong>{String(countdown[unit]).padStart(2, "0")}</strong><span>{unit.slice(0, 3)}</span></div>
        ))}
      </div>
    </div>
  );
}

function getStats(items: ContentItem[], watched: Set<string>, includeOptional = false) {
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

  return {
    percent: totalUnits ? (watchedUnits === totalUnits ? 100 : Math.min(99, Math.round((watchedUnits / totalUnits) * 100))) : 0,
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

function ProgressRing({ value }: { value: number }) {
  return (
    <div className="progress-ring" style={{ "--progress": `${value * 3.6}deg` } as React.CSSProperties}>
      <div><strong>{value}%</strong><span>SYNCED</span></div>
    </div>
  );
}

function useDialogBehavior(onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    window.requestAnimationFrame(() => {
      const firstControl = dialog?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled])');
      (firstControl ?? dialog)?.focus();
    });

    function onKeyDown(event: globalThis.KeyboardEvent) {
      const activeAlert = document.querySelector<HTMLElement>('[role="alertdialog"]');
      if (activeAlert && activeAlert !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = priorOverflow;
      previousFocus?.focus();
    };
  }, []);

  return dialogRef;
}

function TimelineCard({
  item,
  index,
  watched,
  busy,
  onOpen,
  onOpenPrerequisite,
  onToggle,
}: {
  item: ContentItem;
  index: number;
  watched: Set<string>;
  busy: boolean;
  onOpen: () => void;
  onOpenPrerequisite: (item: ContentItem) => void;
  onToggle: (item: ContentItem, episode: number, value: boolean) => void;
}) {
  const complete = itemComplete(item, watched);
  const unlocked = isUnlocked(item, watched);
  const reason = unlockReason(item, watched);
  const prerequisite = missingPrerequisite(item, watched);
  const episodeWatched = item.episodes?.filter((episode) => watched.has(progressKey(item.id, episode.id))).length ?? 0;

  return (
    <article id={`timeline-item-${item.id}`} className={`timeline-card ${item.universe} ${complete ? "is-complete" : ""} ${!unlocked ? "is-locked" : ""} ${!item.required ? "is-optional" : ""}`}>
      <button className="card-visual" onClick={onOpen} aria-label={`Open ${item.title} details`}>
        <Image src={posterUrl(item)} alt={`${item.title} poster`} fill sizes="(max-width: 640px) 84px, 112px" />
        <div className="card-scrim" />
        <span className="sequence-number">{String(index + 1).padStart(2, "0")}</span>
        {!unlocked && <span className="poster-lock" aria-hidden="true"><LockKeyhole size={18} /></span>}
        {complete && <div className="complete-stamp"><Check size={17} strokeWidth={3} /></div>}
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
        {!unlocked && <div className="card-lock-note"><LockKeyhole size={15} /><span><strong>Locked:</strong> {reason}</span></div>}
        {prerequisite && <button className="prerequisite-link" onClick={() => onOpenPrerequisite(prerequisite)}>Open {prerequisite.title} <ChevronRight size={14} /></button>}
        {!item.required && <p className="optional-note">Optional entry · excluded from Doomsday readiness</p>}
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

function DetailDrawer({
  item,
  watched,
  busyKey,
  onClose,
  onOpenPrerequisite,
  onToggle,
}: {
  item: ContentItem;
  watched: Set<string>;
  busyKey: string | null;
  onClose: () => void;
  onOpenPrerequisite: (item: ContentItem) => void;
  onToggle: (item: ContentItem, episode: number, value: boolean) => void;
}) {
  const complete = itemComplete(item, watched);
  const unlocked = isUnlocked(item, watched);
  const reason = unlockReason(item, watched);
  const prerequisite = missingPrerequisite(item, watched);
  const dialogRef = useDialogBehavior(onClose);
  const titleId = `details-${item.id}-title`;
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
          {!unlocked && <div className="prerequisite-alert"><LockKeyhole size={18} /><div><strong>PREREQUISITE REQUIRED</strong><p>{reason}</p>{prerequisite && <button onClick={() => onOpenPrerequisite(prerequisite)}>Open {prerequisite.title} <ChevronRight size={14} /></button>}</div></div>}
          <p className="drawer-summary">{item.summary}</p>
          <div className="lore-brief"><span><Orbit size={16} /> CONTINUITY BRIEF</span><p>{item.lore}</p></div>

          {item.kind === "series" ? (
            <section className="episode-section">
              <div className="section-heading"><div><p className="eyebrow">EPISODE MATRIX</p><h3>Season progress</h3></div><span>{item.episodes?.filter((episode) => watched.has(progressKey(item.id, episode.id))).length ?? 0}/{item.episodes?.length ?? 0}</span></div>
              <div className="episode-list">
                {(item.episodes ?? []).map((episode, index) => {
                  const checked = watched.has(progressKey(item.id, episode.id));
                  const priorDone = index === 0 || watched.has(progressKey(item.id, episode.id - 1));
                  const episodeUnlocked = unlocked && priorDone;
                  const key = progressKey(item.id, episode.id);
                  return (
                    <button key={episode.id} className={`episode-row ${checked ? "checked" : ""}`} disabled={!episodeUnlocked || busyKey === key || item.dataPending} onClick={() => onToggle(item, episode.id, !checked)}>
                      <span className="episode-check">{checked ? <Check size={15} /> : episodeUnlocked && !item.dataPending ? <Play size={13} /> : <LockKeyhole size={13} />}</span>
                      <span className="episode-number">E{String(episode.id).padStart(2, "0")}</span>
                      <span className="episode-name">{item.dataPending ? `Episode ${episode.id} — metadata pending` : episode.title}</span>
                      <span className="episode-runtime">{episode.runtimeSec ? formatRuntime(episode.runtimeSec).replace("00h ", "").replace(" 00s", "") : "TBD"}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : (
            <button className="primary-action drawer-action" disabled={!unlocked || busyKey === progressKey(item.id)} onClick={() => onToggle(item, -1, !complete)}>
              {complete ? "Remove watched status" : unlocked ? "Mark as watched" : "Complete prerequisite first"}{complete ? <X size={17} /> : <Check size={17} />}
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

function LoreDrawer({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialogBehavior(onClose);
  return (
    <div className="drawer-shell">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Close lore brief" />
      <aside ref={dialogRef} className="detail-drawer lore-drawer" role="dialog" aria-modal="true" aria-labelledby="lore-drawer-title" tabIndex={-1}>
        <div className="lore-header">
          <button className="close-button" onClick={onClose} aria-label="Close lore brief"><X size={19} /></button>
          <div className="lore-orbit"><Orbit size={46} /></div>
          <p className="eyebrow">TVA FILE // 616-FX</p>
          <h2 id="lore-drawer-title">Chronological Lore &amp; Continuity Brief</h2>
          <p>How each archive is sequenced—and where its three story tracks touch.</p>
        </div>
        <div className="drawer-content lore-copy">
          <section><span>01</span><div><h3>Release order is the protection layer</h3><p>The MCU chain interleaves films and required series by release. Character reveals, post-credit scenes, and shifting alliances therefore land in their intended order. Optional transmissions appear in position but never become gates.</p></div></section>
          <section><span>02</span><div><h3>Mutant release order and the Deadpool exception</h3><p>The X-Men films retain their release-order locks. Deadpool requires only X-Men (2000), and Deadpool 2 requires only Deadpool. Deadpool &amp; Wolverine then rejoins the normal release-order gate and requires every earlier non-optional X-Men film.</p></div></section>
          <section><span>03</span><div><h3>The Multiverse of Madness bridge</h3><p>Before Doctor Strange enters the Multiverse of Madness, X-Men (2000) must be complete. It establishes Charles Xavier, the mutant team, and the legacy universe needed to understand a major alternate-reality connection.</p></div></section>
          <section><span>04</span><div><h3>The street-level chain</h3><p>The Defenders-era seasons, Hawkeye, Echo, and Daredevil: Born Again form their own release-order track. Hawkeye additionally requires Avengers: Endgame, but completing Hawkeye is never required to continue the MCU timeline.</p></div></section>
          <section><span>05</span><div><h3>Doomsday readiness rule</h3><p>Before watching Avengers: Doomsday, complete every non-optional MCU entry and every non-optional X-Men entry. The universal progress ring excludes optional content and the Street-Level Saga. Each tab has a separate archive-completion ring that includes its optional movies and seasons.</p></div></section>
          <section><span>06</span><div><h3>TVA and the road to Doomsday</h3><p>Loki establishes branching timelines and the TVA; later stories expose collisions between realities. Deadpool &amp; Wolverine becomes a shared bridge, while The Fantastic Four: First Steps adds another universe converging toward Doomsday.</p></div></section>
          <div className="protocol-note"><ShieldCheck size={18} /><p>This brief is spoiler-controlled. Entry-specific files reveal only the context needed to understand why an item occupies its position.</p></div>
        </div>
      </aside>
    </div>
  );
}

export default function MarvelNexus() {
  const [user, setUser] = useState<User | null>(null);
  const [progress, setProgress] = useState<ProgressRecord[]>([]);
  const [databaseMode, setDatabaseMode] = useState("TIMELINE VAULT");
  const [loading, setLoading] = useState(true);
  const [universe, setUniverse] = useState<Universe>("mcu");
  const [requirementFilter, setRequirementFilter] = useState<RequirementFilter>("all");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<ContentItem | null>(null);
  const [loreOpen, setLoreOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pendingUnwatch, setPendingUnwatch] = useState<PendingUnwatch | null>(null);
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  const scrollToken = useRef(0);
  const tabRefs = useRef<Record<Universe, HTMLButtonElement | null>>({ mcu: null, xmen: null, street: null });

  async function loadProgress() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/progress", { cache: "no-store" });
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

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/progress", { cache: "no-store", signal: controller.signal })
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
  }, []);

  const watched = useMemo(() => new Set(progress.map((record) => progressKey(record.contentId, record.episode))), [progress]);
  const items = universe === "mcu" ? MCU_CONTENT : universe === "xmen" ? XMEN_CONTENT : STREET_CONTENT;
  const trackStats = useMemo(() => getStats(items, watched, true), [items, watched]);
  const localRequiredStats = useMemo(() => getStats(items, watched), [items, watched]);
  const doomsdayStats = useMemo(() => getStats([...MCU_CONTENT, ...XMEN_CONTENT], watched), [watched]);
  const visibleItems = items.filter((item) => {
    if (requirementFilter === "doomsday") return item.required && item.universe !== "street";
    if (requirementFilter === "optional") return !item.required;
    return true;
  }).filter((item) => {
    if (formatFilter !== "all") return item.kind === formatFilter;
    return true;
  }).filter((item) => item.title.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase()));
  const nextRequired = items.find((item) => item.required && !itemComplete(item, watched));
  const nextUnlocked = items.find((item) => item.required && !itemComplete(item, watched) && isUnlocked(item, watched));

  async function persistToggle(item: ContentItem, episode: number, value: boolean) {
    const key = progressKey(item.id, episode);
    setBusyKey(key);
    setNotice("");
    try {
      const response = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId: item.id, episode, watched: value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Timeline update rejected.");
      setProgress(payload.progress ?? []);
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
      const response = await fetch("/api/auth/logout", { method: "POST" });
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

  function selectUniverse(nextUniverse: Universe, scrollToNext = true) {
    const nextItems = nextUniverse === "mcu" ? MCU_CONTENT : nextUniverse === "xmen" ? XMEN_CONTENT : STREET_CONTENT;
    const nextItem = nextItems.find((item) => item.required && !itemComplete(item, watched));
    setUniverse(nextUniverse);
    setRequirementFilter("all");
    setFormatFilter("all");
    setSearchQuery("");
    if (scrollToNext && nextItem) {
      scrollToken.current += 1;
      setScrollRequest({ contentId: nextItem.id, token: scrollToken.current });
    }
  }

  function openArchiveItem(item: ContentItem) {
    selectUniverse(item.universe, false);
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

  if (loading) return <LoadingScreen />;
  if (loadError) return <main className="loading-screen error-screen"><Zap size={34} /><p className="eyebrow">ARCHIVE LINK INTERRUPTED</p><h1>{loadError}</h1><button className="primary-action" onClick={loadProgress}>Retry connection <ArrowRight size={17} /></button></main>;
  if (!user) return <AuthScreen onAuthenticated={loadProgress} />;

  const activeHero = nextUnlocked ?? nextRequired ?? items.at(-1)!;
  const doomsdayComplete = doomsdayStats.watchedUnits === doomsdayStats.totalUnits;

  return (
    <main className="app-shell">
      <div className="ambient-grid" />
      <header className="topbar">
        <div className="brand-lockup compact">
          <div className="brand-mark"><span>N</span></div>
          <div><strong>NEXUS</strong><small>WATCH PROTOCOL</small></div>
        </div>
        <nav className={mobileMenu ? "open" : ""}>
          <button className="nav-active"><Layers3 size={15} /> Timeline</button>
          <button onClick={() => setLoreOpen(true)}><Orbit size={15} /> Lore brief</button>
        </nav>
        <div className="operator-block">
          <span className="vault-status"><i /> {databaseMode}</span>
          <div className="operator-name"><CircleUserRound size={18} /><div><small>OPERATOR</small><strong>{user.username}</strong></div></div>
          <button className="icon-button" onClick={logout} aria-label="Log out"><LogOut size={17} /></button>
          <button className="icon-button mobile-menu" onClick={() => setMobileMenu((value) => !value)} aria-expanded={mobileMenu} aria-label={mobileMenu ? "Close navigation" : "Open navigation"}><Menu size={18} /></button>
        </div>
      </header>

      <section className="mission-stage">
        <div className="mission-stage-backdrop"><Image src={backdropUrl(activeHero)} alt="" fill priority sizes="100vw" /><div /></div>
        <section className="mission-hero">
        <div className="hero-content">
          <div className="hero-copy">
            <p className="eyebrow"><span className="pulse-dot" /> ACTIVE MISSION // {universe === "mcu" ? "EARTH-616" : universe === "xmen" ? "LEGACY MUTANT" : "STREET-LEVEL"}</p>
            <h1>Road to <em>Doomsday</em></h1>
            <p>{universe === "xmen" ? "Follow the mutant release order; Deadpool and Deadpool 2 use focused exceptions before the final crossover rejoins the main gate." : "Complete every required transmission in release order. The timeline will protect you from what comes next."}</p>
          </div>
          <Countdown />
        </div>
        </section>

        <section className="dashboard-content dashboard-summary">
        <section className="progress-overview global-status-row">
          <div className="status-primary doomsday-progress glass-panel">
            <ProgressRing value={doomsdayStats.percent} />
            <div className="status-copy"><div className="status-label"><p className="eyebrow">UNIVERSAL DOOMSDAY READINESS</p><span>GLOBAL</span></div><h2>{doomsdayComplete ? "Doomsday protocol complete" : "Mission in progress"}</h2><p>{doomsdayStats.watchedUnits} of {doomsdayStats.totalUnits} required checkpoints · {doomsdayStats.movies} movies + {doomsdayStats.specials} specials + {doomsdayStats.totalEpisodes} episodes</p><div className="linear-progress"><span style={{ width: `${doomsdayStats.percent}%` }} /></div></div>
          </div>
          <div className="metric-card runtime-card doomsday-runtime glass-panel"><Clock3 size={22} /><div><span className="scope-pill">GLOBAL</span><small>DOOMSDAY WATCH TIME LEFT</small><strong>{formatRuntime(doomsdayStats.remainingRuntime)}</strong><em>MCU + X-MEN REQUIRED ONLY{doomsdayStats.pendingRuntime ? " · PLUS UNRELEASED RUNTIME" : ""}</em></div></div>
        </section>

        <div className="universe-switch" role="tablist" aria-label="Universe selector">
          <button ref={(node) => { tabRefs.current.mcu = node; }} id="mcu-tab" role="tab" aria-label="MCU timeline" aria-selected={universe === "mcu"} aria-controls="timeline-panel" tabIndex={universe === "mcu" ? 0 : -1} className={universe === "mcu" ? "active" : ""} onKeyDown={(event) => handleTabKeyDown(event, "mcu")} onClick={() => selectUniverse("mcu")}><span className="marvel-word">MARVEL</span><span className="mobile-tab-label">MCU</span><div><strong>MCU TIMELINE</strong><small>EARTH-616 + MULTIVERSE</small></div></button>
          <button ref={(node) => { tabRefs.current.xmen = node; }} id="xmen-tab" role="tab" aria-label="X-Men universe" aria-selected={universe === "xmen"} aria-controls="timeline-panel" tabIndex={universe === "xmen" ? 0 : -1} className={universe === "xmen" ? "active x-active" : ""} onKeyDown={(event) => handleTabKeyDown(event, "xmen")} onClick={() => selectUniverse("xmen")}><span className="x-word">X</span><span className="mobile-tab-label">X-Men</span><div><strong>X-MEN UNIVERSE</strong><small>LEGACY MUTANT TIMELINE</small></div></button>
          <button ref={(node) => { tabRefs.current.street = node; }} id="street-tab" role="tab" aria-label="Street-Level saga" aria-selected={universe === "street"} aria-controls="timeline-panel" tabIndex={universe === "street" ? 0 : -1} className={universe === "street" ? "active street-active" : ""} onKeyDown={(event) => handleTabKeyDown(event, "street")} onClick={() => selectUniverse("street")}><span className="street-word">NYC</span><span className="mobile-tab-label">Street</span><div><strong>STREET-LEVEL SAGA</strong><small>DEFENDERS + NEW YORK LEGACY</small></div></button>
          <span className={`switch-track ${universe}`} />
        </div>

        <section className="status-deck metric-deck local-status-row">
          <div className="status-primary track-status glass-panel">
            <ProgressRing value={trackStats.percent} />
            <div className="status-copy"><p className="eyebrow">CURRENT TAB ARCHIVE</p><h2>{universe === "mcu" ? "MCU completion" : universe === "xmen" ? "X-Men completion" : "Street Saga completion"}</h2><p>{trackStats.watchedUnits} of {trackStats.totalUnits} checkpoints • {trackStats.movies} movies + {trackStats.specials} specials + {trackStats.totalEpisodes} episodes • optional included</p><div className="linear-progress"><span style={{ width: `${trackStats.percent}%` }} /></div></div>
          </div>
          <div className="counter-grid glass-panel">
            <div className="counter-cell"><Film size={18} /><div><small>MOVIES</small><strong>{trackStats.watchedMovies}<span> / {trackStats.movies}</span></strong></div></div>
            <div className="counter-cell"><Tv size={18} /><div><small>SEASONS</small><strong>{trackStats.watchedSeries}<span> / {trackStats.series}</span></strong></div></div>
            <div className="counter-cell"><Star size={18} /><div><small>SPECIALS</small><strong>{trackStats.watchedSpecials}<span> / {trackStats.specials}</span></strong></div></div>
            <div className="counter-cell"><Layers3 size={18} /><div><small>EPISODES LEFT</small><strong>{trackStats.totalEpisodes - trackStats.watchedEpisodes}</strong></div></div>
          </div>
          <div className={`metric-card runtime-card local-runtime ${universe} glass-panel`}><Clock3 size={19} /><div><small>{universe === "mcu" ? "MCU TIME LEFT" : universe === "xmen" ? "X-MEN TIME LEFT" : "STREET SAGA TIME LEFT"}</small><strong>{formatRuntime(localRequiredStats.remainingRuntime)}</strong><em>{universe === "street" ? "LOCAL • NOT REQUIRED FOR DOOMSDAY" : `LOCAL REQUIRED ${universe === "mcu" ? "MCU" : "X-MEN"} ENTRIES ONLY`}{localRequiredStats.pendingRuntime ? " • PLUS UNRELEASED RUNTIME" : ""}</em></div></div>
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
        </section>
      </section>

      <section className="dashboard-content archive-content">
        <div className="archive-heading">
          <div><p className="eyebrow">ARCHIVE // {universe === "mcu" ? "MARVEL CINEMATIC UNIVERSE" : universe === "xmen" ? "LEGACY MUTANT UNIVERSE" : "NEW YORK STREET-LEVEL CONTINUITY"}</p><h2>{universe === "mcu" ? "The Infinity & Multiverse Sagas" : universe === "xmen" ? "The X-Men Film Timeline" : "The Street-Level Saga"}</h2></div>
          <div className="archive-tools">
            <label className="search-field"><Search size={16} /><span className="sr-only">Search this archive</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search this archive" /></label>
            <div className="filter-groups">
              <div className="filter-group"><span>Mission</span><div className="filter-row" aria-label="Filter by Doomsday necessity">
                {([['all', 'All'], ['doomsday', 'Necessary for Doomsday'], ['optional', 'Optional']] as [RequirementFilter, string][]).map(([value, label]) => <button key={value} aria-pressed={requirementFilter === value} disabled={universe === "street" && value === "doomsday"} title={universe === "street" && value === "doomsday" ? "Street-Level entries do not count toward Doomsday readiness" : undefined} className={requirementFilter === value ? "active" : ""} onClick={() => setRequirementFilter(value)}>{label}</button>)}
              </div></div>
              <div className="filter-group"><span>Format</span><div className="filter-row" aria-label="Filter by format">
                {([['all', 'All'], ['movie', 'Movies'], ['series', 'TV shows'], ['special', 'Specials']] as [FormatFilter, string][]).map(([value, label]) => <button key={value} aria-pressed={formatFilter === value} className={formatFilter === value ? "active" : ""} onClick={() => setFormatFilter(value)}>{label}</button>)}
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
                index={items.findIndex((candidate) => candidate.id === item.id)}
                watched={watched}
                busy={busyKey === progressKey(item.id)}
                onOpen={() => setSelected(item)}
                onOpenPrerequisite={openArchiveItem}
                onToggle={toggle}
              />
            </Fragment>
          ))}
          {!visibleItems.length && <div className="empty-state"><Search size={28} /><h3>No transmissions found</h3><p>Try another title or clear the active filters.</p><button onClick={() => { setSearchQuery(""); setRequirementFilter("all"); setFormatFilter("all"); }}>Reset archive view</button></div>}
        </section>
      </section>

      <footer><div className="brand-lockup compact"><div className="brand-mark"><span>N</span></div><div><strong>NEXUS</strong><small>WATCH PROTOCOL</small></div></div><p>Personal viewing archive • Release-order spoiler protection active</p><span><Database size={14} /> {CONTENT.length} transmissions indexed</span></footer>

      {selected && <DetailDrawer item={selected} watched={watched} busyKey={busyKey} onClose={() => setSelected(null)} onOpenPrerequisite={openArchiveItem} onToggle={toggle} />}
      {loreOpen && <LoreDrawer onClose={() => setLoreOpen(false)} />}
      {pendingUnwatch && <UnwatchConfirmation pending={pendingUnwatch} onCancel={() => setPendingUnwatch(null)} onConfirm={confirmUnwatch} />}
      {notice && <div className="toast" role="status" aria-live="polite"><Zap size={16} /> {notice}</div>}
    </main>
  );
}
