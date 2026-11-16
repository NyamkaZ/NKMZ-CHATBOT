"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Sparkles } from "lucide-react";
import { useChatStore } from "@/lib/store";
import ElectricBorder from "@/components/react-bits/ElectricBorder";
import DecryptedText from "@/components/react-bits/DecryptedText";

const LetterGlitch = dynamic(() => import("@/components/react-bits/LetterGlitch"), { ssr: false });
const GLITCH_COLORS = ["#737373", "#a3a3a3", "#e5e5e5"];

export function AuthFrame({ children, decryptHeading = false }: { children: ReactNode; decryptHeading?: boolean }) {
  const locale = useChatStore((state) => state.locale);
  const setLocale = useChatStore((state) => state.setLocale);
  const isMn = locale === "mn";

  return (
    <div className="auth-shell dark relative isolate flex min-h-[100dvh] flex-col overflow-hidden">
      <div className="auth-glitch pointer-events-none absolute inset-0 -z-20" aria-hidden="true">
        <LetterGlitch
          glitchColors={GLITCH_COLORS}
          baseColor="#a3a3a3"
          baseOpacity={0.22}
          glitchAmount={0.16}
          density={0.85}
          speed={0.45}
          fontSize={14}
          spacing={0.35}
          flow={0.35}
          centerFade={0.45}
          edgeFade={0.08}
          interactive={false}
          clickEffect="none"
          dpr={1.25}
        />
      </div>
      <div className="auth-shade pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

      <header className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 py-7 sm:px-10 lg:px-16">
        <Link href="/" className="flex items-center gap-3" aria-label="NKMZ Chat home">
          <span className="font-display text-[15px] font-semibold tracking-tight">NKMZ<span className="ml-1.5 font-normal text-neutral-500">Chat</span></span>
        </Link>
        <div className="flex items-center gap-4 sm:gap-7">
          <Link href="/" className="hidden items-center gap-2 text-xs text-neutral-400 transition-colors hover:text-white sm:inline-flex">
            <ArrowLeft className="h-3.5 w-3.5" />
            {isMn ? "Чат руу буцах" : "Back to chat"}
          </Link>
          <div className="flex rounded-full border border-white/10 bg-black/30 p-1" aria-label={isMn ? "Хэл" : "Language"}>
            {(["mn", "en"] as const).map((language) => (
              <button key={language} type="button" onClick={() => setLocale(language)} aria-pressed={locale === language}
                className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${locale === language ? "bg-white/10 text-white" : "text-neutral-500 hover:text-neutral-200"}`}>
                {language.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1200px] flex-1 items-center gap-14 px-6 py-10 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:gap-24 lg:px-12 lg:py-16">
        <section className="hidden max-w-xl lg:block">
          <div className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-400">
            <Sparkles className="h-3 w-3" />
            {isMn ? "Таны шинэ боломж" : "A space for possibility"}
          </div>
          <p className="font-display text-[clamp(3rem,4.7vw,4.8rem)] font-medium leading-[1.08] tracking-[-0.055em] text-neutral-100">
            {decryptHeading ? (
              <DecryptedText key={`${locale}-first`} text={isMn ? "Сайн санаа" : "Good ideas"} animateOn="inViewHover" sequential speed={55} hoverRadius={90} scrambleColor="#a3a3a3" />
            ) : (isMn ? "Сайн санаа" : "Good ideas")}<br />
            <span className="text-neutral-500">
              {decryptHeading ? (
                <DecryptedText key={`${locale}-second`} text={isMn ? "эндээс эхэлнэ." : "start here."} animateOn="inViewHover" sequential speed={65} hoverRadius={90} scrambleColor="#d4d4d4" />
              ) : (isMn ? "эндээс эхэлнэ." : "start here.")}
            </span>
          </p>
          <p className="mt-7 max-w-[340px] text-[15px] leading-7 text-neutral-400">
            {isMn ? "Асуулт, санаа, дараагийн алхамд тань зориулсан илүү ухаалаг орон зай." : "A clearer space for your questions, ideas, and whatever comes next."}
          </p>
          <div className="mt-12 flex items-center gap-4 text-xs text-neutral-500">
            <span className="h-px w-9 bg-neutral-700" />
            <span>{isMn ? "Төсөөл. Асууж эхэл. Бүтээ." : "Imagine. Ask. Create."}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </div>
        </section>

        <ElectricBorder color="#b5b5b5" glowColor="#d4d4d4" speed={0.45} chaos={0.15} spread={0.15}
          thickness={0.7} strands={2} glow={0.2} intensity={0.22} arcs={0} flicker={0.08}
          borderRadius={26} intro={false} className="auth-card-frame mx-auto w-full max-w-[420px]">
          <section className="auth-card relative space-y-7 rounded-[26px] border border-white/10 bg-[#111111]/95 p-7 sm:p-9">
            {children}
          </section>
        </ElectricBorder>
      </main>

      <footer className="mx-auto flex w-full max-w-[1440px] justify-between gap-4 px-6 pb-7 pt-5 text-[10px] tracking-[0.06em] text-neutral-600 sm:px-10 lg:px-16">
        <span>NKMZ © {new Date().getFullYear()}</span>
        <span>{isMn ? "Санаанаас боломж руу." : "Intelligence, simplified."}</span>
      </footer>
    </div>
  );
}

