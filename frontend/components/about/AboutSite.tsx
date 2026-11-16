"use client";

import Link from "next/link";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";
import { HorizonHeroSection } from "@/components/ui/horizon-hero-section";
import { ScrollBackground } from "./ScrollBackground";
import { useChatStore } from "@/lib/store";

export function AboutSite() {
  const locale = useChatStore(s => s.locale);
  const mn = locale === "mn";
  return (
    <div className="dark relative isolate min-h-screen bg-black text-neutral-100 selection:bg-neutral-700">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-8 sm:px-12 lg:px-20">
        <Link href="/" className="text-xs tracking-[0.15em] uppercase hover:text-white/60">{mn ? "Нүүр хуудас" : "Back to home"}</Link>
        <LanguageSwitch />
      </header>
      <main>
        <section className="relative isolate flex min-h-[100svh] items-end overflow-hidden px-6 pb-20 pt-40 sm:px-12 lg:px-20">
          <ScrollBackground />
          <div className="w-full">
            <p className="mb-7 text-[10px] uppercase tracking-[0.35em] text-white/55">{mn ? "Бидний тухай" : "About the company"}</p>
            <h1 className="font-display text-[clamp(3rem,12vw,11rem)] font-light leading-[0.95] tracking-[-0.065em]">NKMZ<span className="text-[#b84a50]">.</span></h1>
            <div className="mt-12 flex flex-col justify-between gap-6 border-t border-white/20 pt-6 md:flex-row md:items-end">
              <p className="max-w-md text-lg font-light leading-relaxed text-white/65">{mn ? "Мэдлэг, санаа, ажлыг нэгтгэх AI орон зай." : "An AI workspace for knowledge, ideas, and everyday work."}</p>
              <a href="#work" className="text-xs uppercase tracking-[0.2em] text-white/55 hover:text-white">{mn ? "Бүтээгдэхүүнтэй танилцах" : "Explore our product"} — 01</a>
            </div>
          </div>
        </section>
        <section id="work" aria-labelledby="product-title">
          <HorizonHeroSection contained>
            <div className="mx-auto grid min-h-[100svh] max-w-[1600px] content-center gap-10 px-6 py-24 sm:px-12 md:grid-cols-[1fr_2fr] lg:px-20 lg:py-36">
              <p data-horizon-reveal className="text-[10px] uppercase tracking-[0.25em] text-white/55">01 / {mn ? "Манай бүтээгдэхүүн" : "Our product"}</p>
              <div>
                <h2 id="product-title" data-horizon-reveal className="font-display text-5xl font-light tracking-[-0.045em] sm:text-7xl">NKMZ Chat</h2>
                <p className="mt-8 max-w-xl text-lg font-light leading-8 text-white/55">{mn ? "Асуулт асуух, санаагаа хөгжүүлэх, баримт бичигтэй ажиллах нэг орон зай. Өөрийн орчинд ажиллах AI загвартай, Монгол болон Англи хэлний интерфейстэй." : "One space to ask questions, develop ideas, and work with your documents. Powered by local AI models, with an interface in Mongolian and English."}</p>
                <Link href="/" className="mt-10 inline-block border-b border-[#b84a50] pb-2 text-sm hover:text-white/60">{mn ? "Чатыг нээх" : "Open the workspace"}</Link>
                <dl data-horizon-reveal className="mt-20 border-t border-white/15">
                  {[["01", "Interface", "TypeScript / React / Next.js"], ["02", "Backend", "Python / FastAPI / PostgreSQL"], ["03", "Intelligence", "Ollama / ChromaDB / RAG"]].map(([n, title, detail]) => <div key={n} className="grid grid-cols-[30px_1fr] gap-4 border-b border-white/10 py-7 sm:grid-cols-[30px_1fr_1.5fr]"><span className="text-xs text-white/30">{n}</span><dt className="text-sm">{title}</dt><dd className="col-start-2 text-sm text-white/45 sm:col-start-auto">{detail}</dd></div>)}
                </dl>
              </div>
            </div>
          </HorizonHeroSection>
        </section>
      </main>
      <footer className="mx-6 flex justify-between border-t border-white/15 py-8 text-[10px] uppercase tracking-[0.15em] text-white/35 sm:mx-12 lg:mx-20"><span>NKMZ</span><Link href="/">{mn ? "Нүүр хуудас" : "Home"}</Link></footer>
    </div>
  );
}


