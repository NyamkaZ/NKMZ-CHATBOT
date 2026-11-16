"use client";
import { useChatStore } from "@/lib/store";

export function LanguageSwitch() {
  const locale = useChatStore(s => s.locale);
  const setLocale = useChatStore(s => s.setLocale);
  return <div role="group" aria-label={locale === "mn" ? "Хэл сонгох" : "Language"} className="flex shrink-0 rounded-full border border-white/10 bg-black/30 p-1">
    {(["mn", "en"] as const).map(language => <button key={language} type="button" onClick={() => setLocale(language)} aria-label={language === "mn" ? "Монгол" : "English"} aria-pressed={locale === language} className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-white/60 ${locale === language ? "bg-white/10 text-white" : "text-neutral-500 hover:text-neutral-200"}`}>{language.toUpperCase()}</button>)}
  </div>;
}
