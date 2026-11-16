"use client";

import { ArrowUpRight, BookOpen, Clock3, Layers3, MessagesSquare } from "lucide-react";
import PixelCard from "@/components/react-bits/PixelCard";
import { translate, type Locale } from "@/lib/i18n";
import { ModelName } from "./ModelName";

const prompts = [
  { key: "hint1", icon: Clock3, mn: "Үйлчилгээ", en: "Support" },
  { key: "hint2", icon: Layers3, mn: "Багц", en: "Plans" },
  { key: "hint3", icon: BookOpen, mn: "Мэдлэг", en: "Knowledge" },
  { key: "hint4", icon: MessagesSquare, mn: "NKMZ", en: "NKMZ" },
] as const;

interface Props {
  locale: Locale;
  disabled: boolean;
  onPrompt: (text: string) => void;
}

export function ChatWelcome({ locale, disabled, onPrompt }: Props) {
  const mn = locale === "mn";
  return (
    <div className="desk-welcome">
      <div className="desk-content">
        <section className="desk-hero" lang={locale} aria-labelledby="welcome-title">
          <div className="desk-hero-copy animate-fade-up">
            <p className="desk-model"><span className="desk-wave animate-soft-pulse" aria-hidden="true"><i /><i /><i /><i /></span>Ollama<span aria-hidden="true">/</span><ModelName /></p>
            <h1 id="welcome-title">
              {mn ? "Юуны тухай" : "What shall we"}{" "}
              <em>{mn ? "ярилцах вэ?" : "explore?"}</em>
            </h1>
          </div>
        </section>
        <section className="desk-prompts" aria-labelledby="prompt-title">
          <h2 id="prompt-title">{mn ? "Санал болгох асуултууд" : "Suggested questions"}</h2>
          <div className="desk-prompt-grid hint-stagger">
            {prompts.map(({ key, icon: Icon, ...labels }, index) => {
              const question = translate(locale, key);
              return (
                <PixelCard
                  key={key}
                  className="chat-starter animate-fade-up"
                  tabIndex={-1}
                  colors="#8f8f8f,#bfbfbf,#f2f2f2"
                  glowColor="#d4d4d4"
                  gap={8}
                  opacity={0.42}
                  glow={0.2}
                  introDelay={index * 70}
                  radius={13}
                >
                  <button type="button" className="desk-prompt"
                    disabled={disabled} onClick={() => onPrompt(question)}>
                    <span className="desk-prompt-top">
                      <Icon size={17} strokeWidth={1.65} aria-hidden="true" />
                      <span>{labels[locale]}</span>
                      <ArrowUpRight size={15} className="desk-prompt-arrow" aria-hidden="true" />
                    </span>
                    <span className="desk-question">{question}</span>
                  </button>
                </PixelCard>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
