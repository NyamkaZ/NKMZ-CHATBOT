"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, Loader2, PanelLeft } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ChatWelcome } from "./ChatWelcome";
import { OrbitArtwork } from "./OrbitArtwork";
import EtchedAccretion, { type AccretionParams } from "@/components/ui/etched-accretion";
import "./workspace.css";
import { Button } from "@/components/ui/button";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";
import { friendlyError } from "@/lib/errors";
import { useChatStore, type Message } from "@/lib/store";
import { ChatInput } from "./ChatInput";
import { CommandPalette } from "./CommandPalette";
import { MessageBubble } from "./MessageBubble";
import { useChatScroll } from "./useChatScroll";

const EMPTY_MESSAGES: Message[] = [];
// Black and white only: silver disk bands and white streaks on black.
const ORBIT_PARAMS: Partial<AccretionParams> = {
  center: [0.64, 0.43],
  diskColor: "#bdbdbd",
  streakColor: "#ffffff",
  glowColor: "#ffffff",
  cloudColor: "#c8c8c8",
  background: "#000000",
};
const ORBIT_FALLBACK = <OrbitArtwork />;

export function ChatArea() {
  const { currentChatId, history, historyError, title, sidebarOpen, setSidebarOpen,
    selectChat, sendMessage, isSending, generating, limitReached, t, locale } = useChatStore(useShallow(s => ({
    currentChatId: s.currentChatId,
    history: s.currentChatId ? s.messagesByChat[s.currentChatId] : undefined,
    historyError: s.historyError,
    title: s.currentChatTitle,
    sidebarOpen: s.sidebarOpen,
    setSidebarOpen: s.setSidebarOpen,
    selectChat: s.selectChat,
    sendMessage: s.sendMessage,
    isSending: s.isSending,
    generating: !!s.currentChatId && !!s.generating[s.currentChatId],
    limitReached: s.usage !== null && s.usage.remaining <= 0,
    t: s.t,
    locale: s.locale,
  })));

  const messages = history ?? EMPTY_MESSAGES;
  const { scrollRef, onScroll, showLatest, jumpToLatest } = useChatScroll(currentChatId, messages);
  const lastAssistant = messages.findLast(message => message.role === "assistant");
  const waitingForHistory = !!currentChatId && !history && !historyError;

  const sendHint = async (text: string) => {
    try {
      await sendMessage(text);
    } catch (error) {
      toast.error(friendlyError(error, locale, "sendFailed"));
    }
  };

  return (
    <main className="workspace-main flex h-full min-w-0 flex-1 flex-col overflow-hidden" data-reading={!!currentChatId || undefined}>
      <div className="workspace-orbit" aria-hidden="true">
        <EtchedAccretion height="100%" interactive={false} renderScale={0.8} params={ORBIT_PARAMS} fallback={ORBIT_FALLBACK} />
      </div>
      <header className="desk-header">
        {!sidebarOpen && (
          <Button
            id="conversation-sidebar-toggle" variant="ghost" size="icon" className="shrink-0 rounded-xl"
            aria-controls="conversation-sidebar" aria-expanded={sidebarOpen}
            aria-label={locale === "mn" ? "Цэсийг нээх" : "Open sidebar"}
            onClick={() => setSidebarOpen(true)}
          >
            <PanelLeft className="h-5 w-5" aria-hidden="true" />
          </Button>
        )}
        <div className="desk-location min-w-0 flex-1">
          <p className="truncate"><span className="desk-crumb">{locale === "mn" ? "Ажлын талбар" : "Workspace"}<span aria-hidden="true">/</span></span>{title || (currentChatId ? t("chat") : t("newChatTitle"))}</p>
          {generating && <p className="text-[11px] text-muted-foreground">{t("generating")}</p>}
        </div>
        <CommandPalette />
        <Link href="/about" className="desk-about">{t("aboutCompany")}<ArrowUpRight size={13} aria-hidden="true" /></Link>
        <LanguageSwitch />
      </header>
      {currentChatId && history && historyError && (
        <div role="status" className="flex items-center justify-center gap-3 bg-background/80 px-3 py-2 text-xs text-neutral-300">
          {t("historyOutdated")}
          <button className="underline underline-offset-4" onClick={() => selectChat(currentChatId)}>{t("retry")}</button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={onScroll} aria-busy={waitingForHistory}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {currentChatId && !history ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-4 px-5 text-center text-sm">
              {historyError ? (
                <>
                  <p role="alert">{t("historyUnavailable")}</p>
                  <Button variant="outline" size="sm" onClick={() => selectChat(currentChatId)}>{t("retry")}</Button>
                </>
              ) : (
                <p role="status" className="flex items-center gap-2 text-neutral-300">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {t("loadingHistory")}
                </p>
              )}
            </div>
          ) : messages.length === 0 ? (
            <ChatWelcome locale={locale} disabled={isSending || generating || limitReached} onPrompt={sendHint} />
          ) : (
            <div className="mx-auto w-full max-w-3xl px-2 pb-10 pt-2 md:px-0">
              {messages.map(message => (
                <MessageBubble key={message.id} message={message} isLastAssistant={message.id === lastAssistant?.id} />
              ))}
            </div>
          )}
        </div>
        {showLatest && messages.length > 0 && (
          <button type="button" onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-white/20 bg-neutral-900 px-4 py-2 text-xs text-white shadow-lg hover:bg-neutral-800">
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            {locale === "mn" ? "Сүүлийн хариулт руу" : "Jump to latest"}
          </button>
        )}
      </div>
      <ChatInput />
    </main>
  );
}
