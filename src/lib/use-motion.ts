"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(callback: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
function getReducedMotionServerSnapshot() {
  return false;
}

/** Tracks the user's reduced-motion preference, including live changes, without an SSR/hydration mismatch. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, getReducedMotionServerSnapshot);
}

/** Eases a displayed number toward `value` over `durationMs`; returns `value` directly (no animation) under reduced motion. */
export function useAnimatedNumber(value: number, durationMs = 700) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      fromRef.current = value;
      return undefined;
    }
    const from = fromRef.current;
    if (from === value) return undefined;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(Math.round(from + (value - from) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, durationMs, reduced]);

  return reduced ? value : display;
}

const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/**
 * Sets --tilt-x/--tilt-y/--glow-x/--glow-y from pointer position and toggles
 * an `is-tilting` class, so only the one card under the cursor ever gets a
 * 3D transform/compositing layer — not all of them at once. No-ops on touch
 * or reduced motion.
 */
export function usePointerTilt<T extends HTMLElement>(maxDegrees = 7) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!window.matchMedia(FINE_POINTER).matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    function handleEnter() {
      node!.classList.add("is-tilting");
    }
    function handleMove(event: PointerEvent) {
      const rect = node!.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      node!.style.setProperty("--tilt-x", `${(0.5 - py) * maxDegrees * 2}deg`);
      node!.style.setProperty("--tilt-y", `${(px - 0.5) * maxDegrees * 2}deg`);
      node!.style.setProperty("--glow-x", `${px * 100}%`);
      node!.style.setProperty("--glow-y", `${py * 100}%`);
    }
    function handleLeave() {
      node!.classList.remove("is-tilting");
      node!.style.setProperty("--tilt-x", "0deg");
      node!.style.setProperty("--tilt-y", "0deg");
    }

    node.addEventListener("pointerenter", handleEnter);
    node.addEventListener("pointermove", handleMove);
    node.addEventListener("pointerleave", handleLeave);
    return () => {
      node.removeEventListener("pointerenter", handleEnter);
      node.removeEventListener("pointermove", handleMove);
      node.removeEventListener("pointerleave", handleLeave);
    };
  }, [maxDegrees]);
  return ref;
}

/** Sets --mx/--my custom properties from pointer position for a spotlight effect; no-ops on touch. */
export function usePointerGlow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!window.matchMedia(FINE_POINTER).matches) return;

    function handleMove(event: PointerEvent) {
      const rect = node!.getBoundingClientRect();
      node!.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      node!.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }

    node.addEventListener("pointermove", handleMove);
    return () => node.removeEventListener("pointermove", handleMove);
  }, []);
  return ref;
}

/**
 * Delegated cursor spotlight for `.glass-panel` elements: one document-level
 * listener sets --mx/--my on whichever panel the pointer is over, instead of
 * attaching a listener per panel. No-ops on touch devices.
 */
export function useGlassSpotlight() {
  useEffect(() => {
    if (!window.matchMedia(FINE_POINTER).matches) return;

    function handleMove(event: PointerEvent) {
      const panel = (event.target as HTMLElement | null)?.closest<HTMLElement>(".glass-panel");
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      panel.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      panel.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }

    document.addEventListener("pointermove", handleMove, { passive: true });
    return () => document.removeEventListener("pointermove", handleMove);
  }, []);
}

/** Focus trap + Escape-to-close + body-scroll-lock + focus-restore for a modal dialog/drawer. Shared by every drawer, confirmation dialog, and the command palette. */
export function useDialogBehavior(onClose: () => void) {
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

/**
 * Pushes one history entry on mount (for a full-screen overlay that should
 * close on the phone/browser's own Back) and calls `onBackButton` when the
 * user actually triggers that back navigation. Returns `consumeHistoryEntry`,
 * which a UI-initiated close (a Back button, Escape, or a swipe) should call
 * so the pushed entry is popped without the resulting popstate re-triggering
 * `onBackButton` a second time.
 */
export function useHistoryClose(onBackButton: () => void) {
  const pushedRef = useRef(false);
  const onBackRef = useRef(onBackButton);

  useEffect(() => {
    onBackRef.current = onBackButton;
  }, [onBackButton]);

  useEffect(() => {
    history.pushState({ overlay: true }, "", "?lore");
    pushedRef.current = true;

    function onPopState() {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      onBackRef.current();
    }

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // Unmounted some other way (e.g. logout) without consuming our entry —
      // pop it now so a later Back from the dashboard doesn't land on a stale URL.
      if (pushedRef.current) {
        pushedRef.current = false;
        history.back();
      }
    };
  }, []);

  return useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      history.back();
    }
  }, []);
}

const SWIPE_COMMIT_RATIO = 0.3;
const SWIPE_COMMIT_VELOCITY = 0.5; // px/ms

/**
 * Swipe-right-to-dismiss for touch only. Locks to the horizontal axis once a
 * drag clearly isn't a vertical scroll, tracks the finger 1:1 via a direct
 * style mutation (no React state per frame), and commits `onCommit` past 30%
 * of the element's width or on a fast flick; otherwise springs back.
 */
export function useSwipeToDismiss<T extends HTMLElement>(onCommit: () => void, enabled = true) {
  const ref = useRef<T>(null);
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return undefined;

    const drag = { active: false, startX: 0, startY: 0, dx: 0, lastX: 0, lastT: 0, velocity: 0, locked: null as boolean | null };

    function onPointerDown(event: PointerEvent) {
      if (event.pointerType !== "touch") return;
      drag.active = true;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.dx = 0;
      drag.lastX = event.clientX;
      drag.lastT = event.timeStamp;
      drag.velocity = 0;
      drag.locked = null;
    }

    function onPointerMove(event: PointerEvent) {
      if (!drag.active) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (drag.locked === null) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        drag.locked = Math.abs(dx) > Math.abs(dy);
        if (!drag.locked) {
          drag.active = false;
          return;
        }
      }
      if (!drag.locked) return;

      event.preventDefault();
      drag.dx = Math.max(0, dx);
      const dt = Math.max(1, event.timeStamp - drag.lastT);
      drag.velocity = (event.clientX - drag.lastX) / dt;
      drag.lastX = event.clientX;
      drag.lastT = event.timeStamp;
      node!.style.transition = "none";
      node!.style.transform = `translateX(${drag.dx}px)`;
    }

    function onPointerEnd() {
      if (!drag.active) return;
      drag.active = false;
      node!.style.transition = "";
      if (!drag.locked) return;
      const width = node!.getBoundingClientRect().width || 1;
      const commit = drag.dx / width > SWIPE_COMMIT_RATIO || drag.velocity > SWIPE_COMMIT_VELOCITY;
      if (commit) {
        onCommitRef.current();
      } else {
        node!.style.transform = "";
      }
    }

    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove, { passive: false });
    node.addEventListener("pointerup", onPointerEnd);
    node.addEventListener("pointercancel", onPointerEnd);
    return () => {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerEnd);
      node.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [enabled]);

  return ref;
}

/** Runs `apply` inside the native View Transitions API when available and motion is allowed; otherwise runs it directly. */
export function runViewTransition(apply: () => void) {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (typeof doc.startViewTransition === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    doc.startViewTransition(apply);
  } else {
    apply();
  }
}
