"use client";

import { useEffect, useState } from "react";

/** Milliseconds left until `until` (epoch ms), re-rendering once a second while it is in the future. */
export function useRemaining(until: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, until - now) : 0;
}
