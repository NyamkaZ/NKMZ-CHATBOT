"use client";

import { useEffect } from "react";
import { useChatStore } from "@/lib/store";
import { initPwa } from "@/lib/pwa";

export function ClientPreferences() {
  const locale = useChatStore(s => s.locale);
  useEffect(() => {
    const restore = () => {
      try {
        const saved = localStorage.getItem("locale");
        if (saved === "mn" || saved === "en") useChatStore.getState().setLocale(saved);
      } catch {
        // Browsers may disable storage; the in-memory language switch still works.
      }
    };
    restore();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "locale") restore();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(initPwa, []);
  return null;
}
