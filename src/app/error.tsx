"use client";

import { useEffect } from "react";
import { ArrowRight, Zap } from "lucide-react";

// Shown when something throws while a page is rendering. Same look as the "archive link interrupted"
// screen in the app (`.loading-screen.error-screen`). Next.js 16 passes `retry`, which re-fetches and
// re-renders the failed segment.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="loading-screen error-screen">
      <Zap size={34} />
      <p className="eyebrow">ARCHIVE LINK INTERRUPTED</p>
      <h1>Something went wrong</h1>
      <button className="primary-action" onClick={() => retry()}>
        Retry connection <ArrowRight size={17} />
      </button>
    </main>
  );
}
