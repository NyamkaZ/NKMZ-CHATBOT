"use client";

import { useEffect, useMemo, useState } from "react";
import { revealDuration, revealedCount } from "@/lib/typewriter";

/**
 * Reveal `text` gradually, starting at `startedAt` (epoch ms). Without a start
 * time, or when the user prefers reduced motion, the whole text is returned.
 */
export function useTypewriter(text: string, startedAt?: number): { text: string; typing: boolean } {
  // Split by code point so an emoji is never cut in half.
  const characters = useMemo(() => (startedAt ? Array.from(text) : []), [text, startedAt]);
  const duration = revealDuration(characters.length);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt || duration === 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setNow(startedAt + duration);
      return;
    }
    // A timer rather than animation frames: frames stop entirely while the tab
    // is in the background, which would leave the answer stuck on its first letter.
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current - startedAt >= duration) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, [startedAt, duration]);

  if (!startedAt || duration === 0) return { text, typing: false };
  const count = revealedCount(characters.length, now - startedAt);
  if (count >= characters.length) return { text, typing: false };
  return { text: characters.slice(0, count).join(""), typing: true };
}
