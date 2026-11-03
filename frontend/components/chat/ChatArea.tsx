"use client";

import { useEffect, useRef } from "react";
import { useChatStore } from "@/lib/store";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { Button } from "@/components/ui/button";
import { PanelLeft, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

const HINT_KEYS = ["hint1", "hint2", "hint3", "hint4"] as const;

export function ChatArea() {
  const {
    currentChatId,
    messagesByChat,
    chats,
    sidebarOpen,
    setSidebarOpen,
    generating,
    isSending,
    sendMessage,
    t,
  } = useChatStore();

  const messages = currentChatId ? messagesByChat[currentChatId] || [] : [];
  const bottomRef = useRef<HTMLDivElement>(null);
  const title =
    chats.find((c) => c.id === currentChatId)?.title ||
    (currentChatId ? t("chat") : t("newChatTitle"));

  const isGeneratingHere =
    !!currentChatId &&
    !!generating[currentChatId] &&
    (generating[currentChatId].status === "thinking" ||
      generating[currentChatId].status === "streaming");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentChatId, isGeneratingHere]);

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  const onHint = async (text: string) => {
    if (isSending || isGeneratingHere) return;
    try {
      await sendMessage(text);
    } catch (e: unknown) {
      toast.error(
        friendlyError(e, useChatStore.getState().locale, "sendFailed")
      );
    }
  };

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden min-w-0">
      <header className="flex h-14 items-center gap-2 border-b border-border/70 px-3 md:px-4 shrink-0 bg-background/55 backdrop-blur-xl">
        {!sidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl"
            onClick={() => setSidebarOpen(true)}
          >
            <PanelLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold tracking-tight truncate font-display">
            {title}
          </div>
          {isGeneratingHere && (
            <div className="text-[11px] text-primary/90 animate-pulse">
              {t("generating")}
            </div>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-border/80 bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-soft-pulse" />
          Qwen3 8B
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-8 px-5 py-10 text-center">
            <div className="animate-fade-up flex flex-col items-center gap-4 max-w-lg">
              <div className="relative">
                <div className="absolute inset-0 rounded-3xl bg-primary/25 blur-2xl animate-soft-pulse" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-teal-700 text-primary-foreground shadow-glow">
                  <Sparkles className="h-8 w-8" />
                </div>
              </div>
              <div>
                <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-primary mb-2">
                  NKMZ
                </p>
                <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">
                  {t("howCanIHelp")}
                </h1>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                  {t("poweredBy")}{" "}
                  <span className="text-foreground/90 font-medium">
                    Ollama · Qwen3 8B
                  </span>
                  <span className="mx-1.5 text-border">·</span>
                  {t("switchChatsHint")}
                </p>
              </div>
            </div>

            <div className="hint-stagger grid w-full max-w-2xl grid-cols-1 sm:grid-cols-2 gap-2.5">
              {HINT_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={isSending || isGeneratingHere}
                  onClick={() => onHint(t(key))}
                  className="animate-fade-up group rounded-2xl border border-border/80 bg-background/50 px-4 py-3.5 text-left text-sm text-foreground/85 shadow-soft backdrop-blur transition hover:border-primary/35 hover:bg-accent/60 hover:shadow-glow disabled:opacity-50"
                >
                  <span className="block leading-snug group-hover:text-foreground">
                    {t(key)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl w-full px-2 md:px-0 pb-4 pt-2">
            {messages.map((m, idx) => (
              <MessageBubble
                key={m.id}
                message={m}
                isLastAssistant={idx === lastAssistantIdx}
              />
            ))}
            <div ref={bottomRef} className="h-6" />
          </div>
        )}
      </div>

      <ChatInput />
    </div>
  );
}
