"use client";

import { Download, Share, SquarePlus } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { useDialogBehavior } from "@/lib/use-motion";

type InstallPromptEvent = Event & { prompt: () => Promise<void> };
type InstallMode = "prompt" | "ios" | "mac-safari" | "none";
type GuideMode = Exclude<InstallMode, "prompt" | "none">;

// Captured at module load because Chromium can fire this before the dashboard mounts.
let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const standalone = window.matchMedia("(display-mode: standalone)");
  standalone.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    standalone.removeEventListener("change", listener);
  };
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function manualInstallMode(): GuideMode | null {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  const iPadAsMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadAsMac) return "ios";

  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
  const safariVersion = Number(ua.match(/Version\/(\d+)/)?.[1] ?? 0);
  if (/Macintosh/.test(ua) && isSafari && safariVersion >= 17) return "mac-safari";

  return null;
}

function getInstallMode(): InstallMode {
  if (isInstalled()) return "none";
  if (deferredPrompt) return "prompt";
  return manualInstallMode() ?? "none";
}

export function InstallAppButton() {
  const mode = useSyncExternalStore(subscribe, getInstallMode, () => "none" as const);
  const [guide, setGuide] = useState<GuideMode | null>(null);

  if (mode === "none" && !guide) return null;

  async function install() {
    if (mode === "prompt" && deferredPrompt) {
      const event = deferredPrompt;
      // A captured prompt can only be shown once.
      deferredPrompt = null;
      notify();
      await event.prompt();
      return;
    }
    if (mode === "ios" || mode === "mac-safari") setGuide(mode);
  }

  return (
    <>
      {mode !== "none" && (
        <button className="install-app-action" onClick={install} aria-label="Install Doom Flix app">
          <Download size={16} /><span>Install</span>
        </button>
      )}
      {guide && <InstallGuide mode={guide} onClose={() => setGuide(null)} />}
    </>
  );
}

function InstallGuide({ mode, onClose }: { mode: GuideMode; onClose: () => void }) {
  const dialogRef = useDialogBehavior(onClose);
  const ios = mode === "ios";

  return (
    <div className="confirmation-shell">
      <button className="confirmation-backdrop" onClick={onClose} aria-label="Close install instructions" />
      <section ref={dialogRef} className="confirmation-dialog install-guide" role="dialog" aria-modal="true" aria-labelledby="install-guide-title" tabIndex={-1}>
        <div className="confirmation-icon"><Download size={22} /></div>
        <p className="eyebrow">INSTALL DOOM FLIX</p>
        <h2 id="install-guide-title">{ios ? "Add to your Home Screen" : "Add to your Dock"}</h2>
        {ios ? (
          <ol className="install-steps">
            <li>Tap the <strong>Share</strong> button <Share size={15} aria-label="Share icon" /> in your browser&apos;s toolbar.</li>
            <li>Scroll down and choose <strong>Add to Home Screen</strong> <SquarePlus size={15} aria-label="Add icon" />.</li>
            <li>Tap <strong>Add</strong>. Doom Flix will open full-screen from your Home Screen.</li>
          </ol>
        ) : (
          <ol className="install-steps">
            <li>In Safari&apos;s menu bar, choose <strong>File → Add to Dock</strong>, or click <strong>Share</strong> <Share size={15} aria-label="Share icon" /> and pick <strong>Add to Dock</strong>.</li>
            <li>Click <strong>Add</strong>. Doom Flix will open in its own window from your Dock.</li>
          </ol>
        )}
        <div className="confirmation-actions">
          <button className="secondary-action" onClick={onClose}>Got it</button>
        </div>
      </section>
    </div>
  );
}
