"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefCallback } from "react";

import type { ContentItem } from "@/lib/content";
import { useDialogBehavior, useHistoryClose, usePrefersReducedMotion, useSwipeToDismiss } from "@/lib/use-motion";
import { LORE_SCENES, type LoreChapterId, type LoreSceneProps } from "@/components/nexus/lore-scenes";

type Tone = "mcu" | "optional" | "xmen" | "street" | "doomsday";
type SceneData = LoreSceneProps;
type Beat = string | ((data: SceneData) => ReactNode);

type Chapter = {
  id: LoreChapterId;
  tone: Tone;
  title: string;
  beats: Beat[];
};

const CHAPTERS: Chapter[] = [
  {
    id: "intro",
    tone: "doomsday",
    title: "One timeline. Zero spoilers.",
    beats: [
      "Here's how Doom Flix decides what you can watch next — in about a minute.",
      "Scroll to begin",
    ],
  },
  {
    id: "order",
    tone: "mcu",
    title: "Watch them in the order they came out.",
    beats: [
      "Marvel made these to be seen in release order — that's the order Doom Flix follows.",
      "Every title gets a number. Start at 01 and work up.",
    ],
  },
  {
    id: "locks",
    tone: "mcu",
    title: "Locked titles keep the surprises safe.",
    beats: [
      "A title stays locked until you've watched what it builds on.",
      "Finish those and it unlocks. Tap any locked title to see exactly what's left.",
    ],
  },
  {
    id: "optional",
    tone: "optional",
    title: "Optional means safe to skip.",
    beats: [
      "Optional titles sit in the timeline but never lock anything — extra story if you want it.",
      "Developer's pick: Moon Knight. Optional, no prerequisites — watch it any time.",
    ],
  },
  {
    id: "xmen",
    tone: "xmen",
    title: "The X-Men have their own timeline.",
    beats: [
      "The older X-Men films unlock in release order too, separate from the MCU line.",
      "Shortcut: Deadpool only needs X-Men (2000), and Deadpool 2 only needs Deadpool.",
      "Deadpool & Wolverine waits until you've caught up on the main X-Men films and Deadpool 2.",
    ],
  },
  {
    id: "bridge",
    tone: "xmen",
    title: "Where the two worlds meet.",
    beats: [
      "Before Doctor Strange in the Multiverse of Madness, watch X-Men (2000).",
      "That film opens a door between universes — X-Men (2000) makes sure the moment lands.",
    ],
  },
  {
    id: "street",
    tone: "street",
    title: "Street-Level: pick your hero.",
    beats: [
      "Daredevil, Jessica Jones, Luke Cage, Iron Fist — start with any. Each show's seasons stay in order.",
      "The Defenders brings them together: watch Daredevil S1–2 and the other three first seasons before it.",
      "After The Defenders, their next seasons unlock.",
    ],
  },
  {
    id: "counts",
    tone: "doomsday",
    title: "What counts toward Doomsday.",
    beats: [
      "Your readiness counts every required MCU and X-Men title — each movie, special and episode.",
      "Optional titles and the Street-Level saga are bonus. Each tab's own ring counts everything in that tab.",
      (data) => <>You&apos;re <strong>{data.doomsdayPercent}%</strong> ready, with required viewing time still to go.</>,
    ],
  },
  {
    id: "finale",
    tone: "doomsday",
    title: "Every road leads to Doomsday.",
    beats: [
      "Loki opened the door to branching timelines — since then, universes keep colliding.",
      () => <>They all lead to <strong>Avengers: Doomsday</strong> — December 18, 2026.</>,
    ],
  },
];

function renderBeat(beat: Beat, data: SceneData) {
  return <p>{typeof beat === "string" ? beat : beat(data)}</p>;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
}

export function LoreExperience({
  watched,
  doomsdayPercent,
  remainingSeconds,
  daysLeft,
  nextUp,
  onOpenItem,
  onExit,
}: {
  watched: Set<string>;
  doomsdayPercent: number;
  remainingSeconds: number;
  daysLeft: number;
  nextUp?: ContentItem;
  onOpenItem: (item: ContentItem) => void;
  onExit: () => void;
}) {
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [closing, setClosing] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const beatElsRef = useRef(new Map<string, HTMLElement>());
  const beatMetricsRef = useRef<{ chapter: number; beat: number; center: number }[]>([]);

  const consumeHistoryEntry = useHistoryClose(() => setClosing(true));
  const requestClose = useCallback(() => {
    setClosing((current) => {
      if (!current) consumeHistoryEntry();
      return true;
    });
  }, [consumeHistoryEntry]);

  const dialogRef = useDialogBehavior(requestClose);
  const swipeRef = useSwipeToDismiss<HTMLElement>(requestClose);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(onExit, reducedMotion ? 0 : 280);
    return () => window.clearTimeout(timer);
  }, [closing, onExit, reducedMotion]);

  // One-time swipe hint for touch visitors, shown once per browser session.
  // Deferred to a rAF so the setState calls aren't synchronous within the effect body.
  useEffect(() => {
    let hideTimer = 0;
    const frame = window.requestAnimationFrame(() => {
      if (!window.matchMedia("(pointer: coarse)").matches) return;
      let seen = false;
      try {
        seen = sessionStorage.getItem("doomflix.lore.swipeHintSeen") === "1";
      } catch {
        // Private browsing / blocked storage: just show the hint every time.
      }
      if (seen) return;
      setShowSwipeHint(true);
      hideTimer = window.setTimeout(() => {
        setShowSwipeHint(false);
        try {
          sessionStorage.setItem("doomflix.lore.swipeHintSeen", "1");
        } catch {
          // Nothing else depends on this persisting.
        }
      }, 3200);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, []);

  // Measure each beat's vertical center, relative to the scroll content
  // (via offsetTop, which is stable regardless of current scroll position),
  // once on mount and again on resize/orientation change. `.lore-scroll` is
  // the positioned ancestor for every `.lore-beat`, so offsetTop is already
  // content-relative with no further arithmetic needed.
  useEffect(() => {
    function measure() {
      const metrics: { chapter: number; beat: number; center: number }[] = [];
      for (const [key, el] of beatElsRef.current.entries()) {
        const [chapter, beat] = key.split("-").map(Number);
        metrics.push({ chapter, beat, center: el.offsetTop + el.offsetHeight / 2 });
      }
      metrics.sort((a, b) => a.center - b.center);
      beatMetricsRef.current = metrics;
    }
    measure();
    window.addEventListener("resize", measure);
    // Re-measure once more shortly after mount: web fonts or image aspect
    // ratios settling in can shift beat heights after the first layout pass.
    const settleTimer = window.setTimeout(measure, 300);
    return () => {
      window.removeEventListener("resize", measure);
      window.clearTimeout(settleTimer);
    };
  }, []);

  // Drive the whole guide from one continuous value instead of a discrete
  // "which beat is active" flag: on every scroll frame, find exactly where
  // the viewport's center falls between the two beats bracketing it, as a
  // fractional position (e.g. 1.35 = 35% of the way from beat 1 to beat 2).
  // The chapter index (coarse; which scene is mounted) still goes through
  // React state, since it only changes a few times per read. The fractional
  // position *within* that chapter is written straight to a CSS custom
  // property on the stage via a ref — every scene's CSS reads it directly in
  // calc()/clamp() expressions, so visuals move continuously with the scroll
  // instead of snapping in a single jump when a threshold is crossed, and
  // skipping React entirely here keeps a 60fps scroll cheap.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    let frame = 0;

    function update() {
      frame = 0;
      const metrics = beatMetricsRef.current;
      if (!metrics.length) return;

      const mid = node!.scrollTop + node!.clientHeight / 2;
      let globalPos = 0;
      if (mid <= metrics[0].center) {
        globalPos = 0;
      } else if (mid >= metrics[metrics.length - 1].center) {
        globalPos = metrics.length - 1;
      } else {
        for (let i = 0; i < metrics.length - 1; i++) {
          const a = metrics[i];
          const b = metrics[i + 1];
          if (mid >= a.center && mid <= b.center) {
            globalPos = i + (mid - a.center) / Math.max(1, b.center - a.center);
            break;
          }
        }
      }

      const nearestIndex = Math.min(metrics.length - 1, Math.max(0, Math.round(globalPos)));
      const chapter = metrics[nearestIndex].chapter;
      const chapterStartIndex = metrics.findIndex((m) => m.chapter === chapter);
      const chapterBeatCount = metrics.filter((m) => m.chapter === chapter).length;
      const localProgress = Math.max(0, Math.min(chapterBeatCount - 1, globalPos - chapterStartIndex));

      setActiveChapterIndex((current) => (current === chapter ? current : chapter));

      const stageNode = stageRef.current;
      if (stageNode) {
        stageNode.style.setProperty("--lore-p0", String(Math.max(0, Math.min(1, localProgress))));
        stageNode.style.setProperty("--lore-p1", String(Math.max(0, Math.min(1, localProgress - 1))));
      }

      const max = node!.scrollHeight - node!.clientHeight;
      const ratio = max > 0 ? node!.scrollTop / max : 0;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${ratio})`;
    }

    function onScroll() {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    }

    node.addEventListener("scroll", onScroll, { passive: true });
    // Run once after the initial measurement settles, so the guide opens
    // already reflecting beat 0 instead of waiting for the first scroll.
    const initTimer = window.setTimeout(update, 50);
    return () => {
      node.removeEventListener("scroll", onScroll);
      window.clearTimeout(initTimer);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  function registerBeat(chapterIndex: number, beatIndex: number, node: HTMLElement | null) {
    const key = `${chapterIndex}-${beatIndex}`;
    if (node) beatElsRef.current.set(key, node);
    else beatElsRef.current.delete(key);
  }

  function jumpToChapter(index: number) {
    const el = beatElsRef.current.get(`${index}-0`);
    el?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  const handleOpenItem = useCallback(
    (item: ContentItem) => {
      requestClose();
      onOpenItem(item);
    },
    [requestClose, onOpenItem],
  );

  const sceneData: SceneData = useMemo(
    () => ({ watched, doomsdayPercent, remainingSeconds, daysLeft, nextUp, onOpenItem: handleOpenItem }),
    [watched, doomsdayPercent, remainingSeconds, daysLeft, nextUp, handleOpenItem],
  );

  const activeChapter = CHAPTERS[activeChapterIndex];

  return (
    <div
      ref={mergeRefs(dialogRef, swipeRef)}
      className={`lore-shell ${closing ? "is-closing" : ""}`}
      data-tone={activeChapter.tone}
      role="dialog"
      aria-modal="true"
      aria-label="Doom Flix guide"
      tabIndex={-1}
    >
      <div ref={scrollRef} className="lore-scroll">
        <header className="lore-topbar">
          <button className="lore-back" onClick={requestClose} aria-label="Back to dashboard">
            <ArrowLeft size={17} /> Back <kbd className="lore-esc-hint">Esc</kbd>
          </button>
          <div className="lore-chapter-label">
            <span>{String(activeChapterIndex + 1).padStart(2, "0")} / {String(CHAPTERS.length).padStart(2, "0")}</span>
            <strong>{activeChapter.title}</strong>
          </div>
          <div className="lore-progress-track" aria-hidden="true"><span ref={progressRef} className="lore-progress-fill" /></div>
        </header>

        <div className="lore-text">
          {CHAPTERS.map((chapter, chapterIndex) => (
            <section key={chapter.id} className="lore-chapter-block">
              <h2 className="lore-chapter-title">{chapter.title}</h2>
              {chapter.beats.map((beat, beatIndex) => (
                <div
                  key={beatIndex}
                  ref={(node) => registerBeat(chapterIndex, beatIndex, node)}
                  data-beat-key={`${chapterIndex}-${beatIndex}`}
                  className="lore-beat"
                >
                  {renderBeat(beat, sceneData)}
                </div>
              ))}
            </section>
          ))}
          <div className="lore-end-spacer" />
        </div>
      </div>

      <div ref={stageRef} className="lore-stage" aria-hidden="true">
        {CHAPTERS.map((chapter, index) => {
          if (Math.abs(index - activeChapterIndex) > 1) return null;
          const Scene = LORE_SCENES[chapter.id];
          const isActive = index === activeChapterIndex;
          return (
            <div key={chapter.id} className="lore-stage-scene" data-active={isActive}>
              <Scene {...sceneData} />
            </div>
          );
        })}
        <div className="lore-stage-numeral">{String(activeChapterIndex + 1).padStart(2, "0")}</div>
      </div>

      <nav className="lore-rail" aria-label="Chapters">
        {CHAPTERS.map((chapter, index) => (
          <button
            key={chapter.id}
            type="button"
            className={`lore-rail-dot ${index === activeChapterIndex ? "active" : ""}`}
            onClick={() => jumpToChapter(index)}
            aria-label={chapter.title}
            aria-current={index === activeChapterIndex ? "true" : undefined}
          />
        ))}
      </nav>

      {showSwipeHint && <div className="lore-swipe-hint">Swipe right to go back</div>}
    </div>
  );
}
