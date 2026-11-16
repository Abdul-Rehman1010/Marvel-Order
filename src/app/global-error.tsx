"use client";

import { ArrowRight, Zap } from "lucide-react";

import "./globals.css";

// Replaces the root layout when the layout itself fails, so it has to bring its own <html>, <body>
// and styles. The web fonts are set up in `layout.tsx`, so this screen falls back to system fonts.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  void error;
  return (
    <html lang="en">
      <body>
        <main className="loading-screen error-screen">
          <Zap size={34} />
          <p className="eyebrow">ARCHIVE LINK INTERRUPTED</p>
          <h1>Something went wrong</h1>
          <button className="primary-action" onClick={() => retry()}>
            Retry connection <ArrowRight size={17} />
          </button>
        </main>
      </body>
    </html>
  );
}
