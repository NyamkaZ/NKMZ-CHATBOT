"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Loader2, Plus, PanelLeftClose, Search, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";
import { KnowledgeBase } from "./KnowledgeBase";
import { AccountMenu } from "./AccountMenu";
import { ModelName } from "./ModelName";
import { ConversationRow } from "./ConversationRow";
import { groupChats } from "./chatGroups";

const panelId = "conversation-sidebar";

function focusSidebarToggle() {
  document.getElementById("conversation-sidebar-toggle")?.focus();
}

export function Sidebar() {
  const { chats, currentChatId, sidebarOpen, searchQuery, locale, authLoaded, isLoadingChats, chatListError, setSidebarOpen, setSearchQuery, loadChats, t } =
    useChatStore(useShallow(s => ({
      chats: s.chats, currentChatId: s.currentChatId, sidebarOpen: s.sidebarOpen,
      searchQuery: s.searchQuery, locale: s.locale, authLoaded: s.authLoaded,
      isLoadingChats: s.isLoadingChats, chatListError: s.chatListError, t: s.t,
      setSidebarOpen: s.setSidebarOpen, setSearchQuery: s.setSearchQuery, loadChats: s.loadChats,
    })));
  const [desktop, setDesktop] = useState<boolean | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const search = useRef<HTMLInputElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const mongolian = locale === "mn";
  const panelTitle = mongolian ? "Чатын жагсаалт" : "Conversations";
  const searching = !!searchQuery.trim();
  // Search results keep the server's order; history is grouped by day.
  const groups = useMemo(() => (searching ? [] : groupChats(chats)), [chats, searching]);

  useEffect(() => {
    const breakpoint = window.matchMedia("(min-width: 768px)");
    const resize = () => {
      setDesktop(breakpoint.matches);
      setSidebarOpen(breakpoint.matches);
    };
    resize();
    breakpoint.addEventListener("change", resize);
    try {
      const persona = localStorage.getItem("persona");
      if (persona) useChatStore.getState().setPersona(persona);
    } catch { /* Keep the default persona when storage is unavailable. */ }
    return () => breakpoint.removeEventListener("change", resize);
  }, [setSidebarOpen]);

  useEffect(() => {
    if (!authLoaded) return;
    const timer = setTimeout(loadChats, 280);
    return () => clearTimeout(timer);
  }, [searchQuery, authLoaded, loadChats]);

  const select = useCallback((id: string) => {
    void useChatStore.getState().selectChat(id);
    if (!desktop) setSidebarOpen(false);
  }, [desktop, setSidebarOpen]);
  const focusSearch = useCallback(() => search.current?.focus(), []);

  if (desktop === null) return null;

  const row = (chat: typeof chats[number]) => <ConversationRow key={chat.id} chat={chat} active={currentChatId === chat.id}
    locale={locale} onSelect={select} onDeleted={focusSearch} />;
  const groupHeading = "mx-2 mb-2 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400";
  const rule = <span aria-hidden className="h-px flex-1 bg-white/10" />;

  const contents = (
    <>
      <div className="shrink-0 px-5 pt-6">
        <div className="mb-7 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 whitespace-nowrap leading-none">
              <span className="font-display text-[25px] font-semibold tracking-[-0.055em] text-neutral-100">NKMZ</span>
              <span className="font-serif text-[23px] italic tracking-[-0.045em] text-neutral-300">Chat</span>
            </div>
            <div className="mt-2 truncate text-[11px] leading-4 text-neutral-400"><ModelName /></div>
          </div>
          <Button ref={close} variant="ghost" size="icon" className="-mr-1 h-9 w-9 rounded-lg text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-100"
            aria-label={mongolian ? "Цэсийг хаах" : "Close sidebar"} onClick={() => {
              setSidebarOpen(false);
              if (desktop) requestAnimationFrame(focusSidebarToggle);
            }}>
            <PanelLeftClose aria-hidden className="h-4 w-4" />
          </Button>
        </div>
        <LiquidMetalButton fullWidth size={44} contentClassName="justify-between px-5"
          onClick={() => {
            useChatStore.getState().createNewChat();
            if (!desktop) setSidebarOpen(false);
          }}>
          {t("newChat")}<Plus aria-hidden className="h-4 w-4" strokeWidth={1.8} />
        </LiquidMetalButton>
      </div>

      <div className="group relative mx-5 mt-2 shrink-0">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400 group-focus-within:text-neutral-300" strokeWidth={1.6} />
        <Input ref={search} type="text" inputMode="search" autoComplete="off"
          aria-label={t("searchChats")} placeholder={t("searchChats")} aria-controls="conversation-list"
          className="h-10 rounded-xl border-white/[0.09] bg-white/[0.025] pl-9 pr-9 text-[13px] text-neutral-100 placeholder:text-neutral-400 focus-visible:border-neutral-300/55 focus-visible:ring-1 focus-visible:ring-neutral-300/50"
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        {searchQuery && <button type="button" aria-label={mongolian ? "Хайлтыг цэвэрлэх" : "Clear search"}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-300"
          onClick={() => { setSearchQuery(""); focusSearch(); }}>
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>}
      </div>

      <h2 id="conversation-list-title" className="sr-only">
        {searching ? (mongolian ? "Хайлтын үр дүн" : "Search results") : (mongolian ? "Чатын түүх" : "Chat history")}
      </h2>
      <div className="mt-7 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {(searching || chats.length === 0) && (
          <div className={groupHeading}>
            <span>{searching ? (mongolian ? "Хайлтын үр дүн" : "Search results") : (mongolian ? "Чатын түүх" : "Chat history")}</span>{rule}
          </div>
        )}
        {isLoadingChats && chats.length === 0 && (
          <div role="status" className="flex justify-center py-8">
            <Loader2 aria-hidden className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
            <span className="sr-only">{mongolian ? "Чатыг ачаалж байна" : "Loading conversations"}</span>
          </div>
        )}
        {chatListError && (
          <div role="alert" className="mx-1 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 text-xs leading-relaxed text-neutral-300">
            <p>{mongolian ? "Чатын жагсаалтыг ачаалж чадсангүй." : "Couldn’t load your conversations."}</p>
            <button type="button" onClick={() => loadChats()}
              className="mt-2 rounded-sm py-1 font-medium text-neutral-200 underline decoration-neutral-200/40 underline-offset-4 hover:decoration-current focus-visible:ring-2 focus-visible:ring-neutral-300">{t("retry")}</button>
          </div>
        )}
        {!isLoadingChats && !chatListError && chats.length === 0 && (
          <p role="status" className="px-2 py-3 text-xs leading-relaxed text-neutral-400">
            {searchQuery ? (mongolian ? "Тохирох чат олдсонгүй." : "No matching conversations.") : t("noConversations")}
          </p>
        )}
        <div id="conversation-list" aria-labelledby="conversation-list-title" aria-busy={isLoadingChats} className="space-y-5">
          {searching ? chats.length > 0 && <ul className="space-y-1">{chats.map(row)}</ul> : groups.map(group => (
            <section key={group.key} aria-labelledby={`chat-group-${group.key}`}>
              <h3 id={`chat-group-${group.key}`} className={groupHeading}><span>{t(group.key)}</span>{rule}</h3>
              <ul className="space-y-1">{group.chats.map(row)}</ul>
            </section>
          ))}
        </div>
      </div>

      <div className="mx-4 shrink-0 border-t border-white/10 py-3">
        <AccountMenu onKnowledge={() => {
          if (!desktop) setSidebarOpen(false);
          setKbOpen(true);
        }} />
      </div>
    </>
  );

  return (
    <>
      {desktop ? (
        // The panel slides shut by collapsing its width, so the chat area
        // grows into the space instead of jumping. The first paint is not animated.
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside key="sidebar" id={panelId} aria-label={panelTitle}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={reduceMotion ? { duration: 0 } : {
                width: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
                opacity: { duration: 0.2, ease: "easeOut" },
              }}
              className="relative z-40 h-full shrink-0 overflow-hidden border-r border-white/10 bg-[#080808] text-neutral-100 backdrop-blur-md">
              {/* Fixed-width inner panel: its contents never reflow while the edge moves. */}
              <div className="flex h-full w-64 flex-col xl:w-[272px]">
                {contents}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      ) : (
        <Dialog.Root open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="sidebar-overlay fixed inset-0 z-40 bg-black/60" />
            <Dialog.Content id={panelId} aria-describedby={undefined}
              className="sidebar-sheet fixed inset-y-0 left-0 z-50 flex w-[min(21rem,88vw)] flex-col overflow-hidden border-r border-white/10 bg-[#080808] pb-[env(safe-area-inset-bottom)] text-neutral-100 shadow-2xl outline-none"
              onOpenAutoFocus={e => { e.preventDefault(); close.current?.focus(); }}
              onCloseAutoFocus={e => { e.preventDefault(); focusSidebarToggle(); }}
              onEscapeKeyDown={e => {
                if (e.target instanceof Element && e.target.closest("[data-chat-row-action]")) e.preventDefault();
              }}>
              <Dialog.Title className="sr-only">{panelTitle}</Dialog.Title>
              {contents}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      <KnowledgeBase open={kbOpen} onClose={() => setKbOpen(false)} />
    </>
  );
}
