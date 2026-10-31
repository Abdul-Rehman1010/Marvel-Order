"use client";

import Image from "next/image";
import { Check, ChevronDown, Lock, Star, Unlock } from "lucide-react";
import { useMemo, type CSSProperties } from "react";

import {
  CONTENT_BY_ID,
  MCU_CONTENT,
  getPrerequisiteChain,
  itemComplete,
  type ContentItem,
} from "@/lib/content";
import { backdropUrl, posterUrl } from "@/lib/media";
import { POSTER_TINTS, DEFAULT_TINT } from "@/lib/poster-tints";

export type LoreSceneProps = {
  beatIndex: number;
  watched: Set<string>;
  doomsdayPercent: number;
  remainingSeconds: number;
  daysLeft: number;
  nextUp?: ContentItem;
  onOpenItem: (item: ContentItem) => void;
};

function tintStyle(item: ContentItem) {
  return { "--tint": POSTER_TINTS[item.id] ?? DEFAULT_TINT } as CSSProperties;
}

function Poster({ item, className = "", sizes = "160px" }: { item: ContentItem; className?: string; sizes?: string }) {
  return (
    <div className={`lore-poster ${className}`} style={tintStyle(item)}>
      <Image src={posterUrl(item)} alt="" fill sizes={sizes} />
    </div>
  );
}

function Backdrop({ item, className = "" }: { item: ContentItem; className?: string }) {
  return (
    <div className={`lore-backdrop-art ${className}`}>
      <Image src={backdropUrl(item)} alt="" fill sizes="70vw" priority={false} />
    </div>
  );
}

/* ---------- 0. Intro ---------- */
export function IntroScene({ beatIndex }: LoreSceneProps) {
  const left = CONTENT_BY_ID.get("defenders-daredevil-1")!;
  const center = CONTENT_BY_ID.get("iron-man")!;
  const right = CONTENT_BY_ID.get("xmen-2000")!;
  const backdrop = CONTENT_BY_ID.get("endgame") ?? center;
  return (
    <div className="lore-scene lore-scene-intro">
      <Backdrop item={backdrop} className="dim" />
      <div className="lore-fan">
        <Poster item={left} className="fan-card fan-left" />
        <Poster item={center} className="fan-card fan-center" />
        <Poster item={right} className="fan-card fan-right" />
      </div>
      <div className="lore-brandmark"><span>D</span></div>
      <div className={`lore-scroll-cue ${beatIndex >= 1 ? "show" : ""}`}><ChevronDown size={18} /> Scroll to begin</div>
    </div>
  );
}

/* ---------- 1. Release order ---------- */
export function OrderScene({ beatIndex, watched }: LoreSceneProps) {
  const phaseOne = useMemo(() => MCU_CONTENT.filter((item) => item.phase === "Phase One"), []);
  return (
    <div className="lore-scene lore-scene-strip">
      <div className="lore-strip">
        {phaseOne.map((item, index) => (
          <div key={item.id} className="lore-strip-card" style={{ "--i": index, ...tintStyle(item) } as CSSProperties}>
            <Poster item={item} sizes="130px" />
            <div className={`lore-strip-tag ${beatIndex >= 1 ? "show" : ""}`}>
              <span className="lore-strip-number">{String(index + 1).padStart(2, "0")}</span>
              {itemComplete(item, watched) && <span className="lore-strip-check"><Check size={12} /></span>}
            </div>
            <small>{item.year}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 2. Locks ---------- */
export function LocksScene({ beatIndex }: LoreSceneProps) {
  const avengers = CONTENT_BY_ID.get("avengers")!;
  const chain = useMemo(() => getPrerequisiteChain(avengers).slice(0, -1), [avengers]);
  const unlocking = beatIndex >= 1;
  return (
    <div className="lore-scene lore-scene-locks">
      <div className={`lore-sealed-card ${unlocking ? "is-unlocking" : ""}`}>
        <Poster item={avengers} className="lore-sealed-poster" sizes="220px" />
        <div className="lore-sealed-badge">{unlocking ? <Unlock size={20} /> : <Lock size={20} />}</div>
      </div>
      <div className="lore-prereq-row">
        {chain.map((item, index) => (
          <div key={item.id} className={`lore-prereq-chip ${unlocking ? "is-checked" : ""}`} style={{ "--i": index } as CSSProperties}>
            <Poster item={item} className="lore-prereq-poster" sizes="70px" />
            <span className="lore-prereq-check"><Check size={11} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 3. Optional ---------- */
export function OptionalScene({ beatIndex }: LoreSceneProps) {
  const required = [CONTENT_BY_ID.get("loki-1")!, CONTENT_BY_ID.get("multiverse-of-madness")!];
  const optional = [CONTENT_BY_ID.get("eternals")!, CONTENT_BY_ID.get("what-if-1")!, CONTENT_BY_ID.get("she-hulk")!];
  const moonKnight = CONTENT_BY_ID.get("moon-knight")!;
  return (
    <div className="lore-scene lore-scene-optional">
      <div className="lore-required-line">
        {required.map((item) => <Poster key={item.id} item={item} sizes="130px" />)}
      </div>
      <div className="lore-optional-row">
        {optional.map((item, index) => (
          <div key={item.id} className="lore-optional-chip" style={{ "--i": index } as CSSProperties}>
            <Poster item={item} sizes="100px" />
            <span className="lore-optional-tag">Optional</span>
          </div>
        ))}
      </div>
      <div className={`lore-devpick ${beatIndex >= 1 ? "show" : ""}`}>
        <Poster item={moonKnight} className="lore-devpick-poster" sizes="130px" />
        <span className="lore-devpick-badge"><Star size={12} fill="currentColor" /> DEV PICK</span>
      </div>
    </div>
  );
}

/* ---------- 4. X-Men ---------- */
export function XMenScene({ beatIndex }: LoreSceneProps) {
  const xmen2000 = CONTENT_BY_ID.get("xmen-2000")!;
  const deadpool = CONTENT_BY_ID.get("deadpool")!;
  const deadpool2 = CONTENT_BY_ID.get("deadpool-2")!;
  const deadpoolWolverine = CONTENT_BY_ID.get("deadpool-wolverine")!;
  return (
    <div className="lore-scene lore-scene-xmen">
      <div className="lore-branch">
        <Poster item={xmen2000} sizes="140px" />
        <svg className={`lore-branch-line ${beatIndex >= 1 ? "draw" : ""}`} viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 10 C 80 10, 80 50, 200 50" />
        </svg>
        <Poster item={deadpool} sizes="140px" />
        <svg className={`lore-branch-line ${beatIndex >= 1 ? "draw" : ""}`} viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 50 C 80 50, 80 10, 200 10" />
        </svg>
        <Poster item={deadpool2} sizes="140px" />
      </div>
      <div className={`lore-branch-join ${beatIndex >= 2 ? "show" : ""}`}>
        <Poster item={deadpoolWolverine} className="lore-branch-final" sizes="150px" />
      </div>
    </div>
  );
}

/* ---------- 5. Bridge ---------- */
export function BridgeScene({ beatIndex }: LoreSceneProps) {
  const xmen2000 = CONTENT_BY_ID.get("xmen-2000")!;
  const madness = CONTENT_BY_ID.get("multiverse-of-madness")!;
  return (
    <div className="lore-scene lore-scene-bridge">
      <Poster item={xmen2000} className="lore-bridge-poster left" sizes="180px" />
      <div className={`lore-bridge-portal ${beatIndex >= 1 ? "active" : ""}`} aria-hidden="true" />
      <svg className={`lore-bridge-line ${beatIndex >= 0 ? "draw" : ""}`} viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 20 L300 20" />
      </svg>
      <Poster item={madness} className="lore-bridge-poster right" sizes="180px" />
    </div>
  );
}

/* ---------- 6. Street ---------- */
export function StreetScene({ beatIndex }: LoreSceneProps) {
  const dd = CONTENT_BY_ID.get("defenders-daredevil-1")!;
  const jj = CONTENT_BY_ID.get("defenders-jessica-jones-1")!;
  const lc = CONTENT_BY_ID.get("defenders-luke-cage-1")!;
  const ifist = CONTENT_BY_ID.get("defenders-iron-fist-1")!;
  const defenders = CONTENT_BY_ID.get("defenders-the-defenders")!;
  const later = [CONTENT_BY_ID.get("defenders-daredevil-2")!, CONTENT_BY_ID.get("hawkeye")!];
  const converged = beatIndex >= 1;
  const split = beatIndex >= 2;
  return (
    <div className="lore-scene lore-scene-street">
      <div className={`lore-quad ${converged ? "converged" : ""}`}>
        <Poster item={dd} className="quad-tl" sizes="120px" />
        <Poster item={jj} className="quad-tr" sizes="120px" />
        <Poster item={lc} className="quad-bl" sizes="120px" />
        <Poster item={ifist} className="quad-br" sizes="120px" />
        <Poster item={defenders} className="quad-center" sizes="130px" />
      </div>
      <div className={`lore-split-row ${split ? "show" : ""}`}>
        {later.map((item) => <Poster key={item.id} item={item} sizes="100px" />)}
      </div>
    </div>
  );
}

/* ---------- 7. What counts ---------- */
export function CountsScene({ beatIndex, doomsdayPercent, remainingSeconds }: LoreSceneProps) {
  const hours = Math.floor(remainingSeconds / 3600);
  return (
    <div className="lore-scene lore-scene-counts">
      <div className={`lore-equation ${beatIndex >= 1 ? "bonus-fade" : ""}`}>
        <div className="lore-eq-tile required">MCU<small>required</small></div>
        <span className="lore-eq-op">+</span>
        <div className="lore-eq-tile required">X-Men<small>required</small></div>
        <span className="lore-eq-op">=</span>
        <div className="lore-eq-result" style={{ "--lore-pct": `${doomsdayPercent * 3.6}deg` } as CSSProperties}>
          <strong>{doomsdayPercent}%</strong>
          <small>ready</small>
        </div>
        <div className="lore-eq-bonus">
          <div className="lore-eq-tile bonus">Optional<small>bonus</small></div>
          <div className="lore-eq-tile bonus">Street-Level<small>bonus</small></div>
        </div>
      </div>
      {beatIndex >= 2 && (
        <p className="lore-eq-caption"><strong>{hours}h</strong> of required viewing left</p>
      )}
    </div>
  );
}

/* ---------- 8. Finale ---------- */
export function FinaleScene({ beatIndex, daysLeft, nextUp, onOpenItem }: LoreSceneProps) {
  const converge = beatIndex >= 0;
  return (
    <div className="lore-scene lore-scene-finale">
      <div className={`lore-converge ${converge ? "converge" : ""}`} aria-hidden="true">
        <span className="line line-mcu" />
        <span className="line line-xmen" />
        <span className="line line-street" />
        <span className="line-point" />
      </div>
      {beatIndex >= 1 && (
        <div className="lore-finale-panel">
          <div className="lore-finale-days"><strong>{daysLeft}</strong><small>days to Doomsday</small></div>
          {nextUp && (
            <button className="lore-finale-next" onClick={() => onOpenItem(nextUp)}>
              <Poster item={nextUp} sizes="60px" />
              <span>
                <small>NEXT UP FOR YOU</small>
                <strong>{nextUp.title}</strong>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const LORE_SCENES = {
  intro: IntroScene,
  order: OrderScene,
  locks: LocksScene,
  optional: OptionalScene,
  xmen: XMenScene,
  bridge: BridgeScene,
  street: StreetScene,
  counts: CountsScene,
  finale: FinaleScene,
} as const;

export type LoreChapterId = keyof typeof LORE_SCENES;
