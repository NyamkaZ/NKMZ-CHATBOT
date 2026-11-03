"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { toast } from "sonner";
import { useChatStore } from "@/lib/store";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUp, Square, Mic, MicOff } from "lucide-react";
import Link from "next/link";

const PERSONAS = [
  { id: "default", label: "Assistant" },
  { id: "coder", label: "Code" },
  { id: "tutor", label: "Tutor" },
  { id: "creative", label: "Creative" },
  { id: "analyst", label: "Analyst" },
];

export function ChatInput() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    currentChatId,
    generating,
    isSending,
    usage,
    sendMessage,
    stopGenerating,
    persona,
    setPersona,
    t,
  } = useChatStore();

  const isCurrentGenerating =
    !!currentChatId &&
    !!generating[currentChatId] &&
    (generating[currentChatId].status === "thinking" ||
      generating[currentChatId].status === "streaming");

  const limitReached = usage !== null && usage.remaining <= 0;
  const disabled = isSending || isCurrentGenerating || limitReached;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [text]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || disabled) return;
    setText("");
    setError(null);
    try {
      await sendMessage(content);
    } catch (e: unknown) {
      const msg = friendlyError(
        e,
        useChatStore.getState().locale,
        "sendFailed"
      );
      setError(msg);
      setText(content);
      toast.error(msg);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleVoice = () => {
    const SR =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition
        : null;
    if (!SR) {
      toast.error("Speech recognition not supported in this browser");
      return;
    }
    if (listening) {
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = useChatStore.getState().locale === "mn" ? "mn-MN" : "en-US";
    rec.interimResults = true;
    rec.onresult = (ev: any) => {
      const transcript = Array.from(ev.results)
        .map((r: any) => r[0].transcript)
        .join("");
      setText(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    setListening(true);
  };

  const usagePct =
    usage && usage.daily_limit > 0 && usage.daily_limit < 999999
      ? Math.min(100, (usage.used_today / usage.daily_limit) * 100)
      : 0;

  return (
    <div className="bg-gradient-to-t from-background via-background/95 to-transparent p-3 md:p-4 pb-[max(0.85rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl">
        {usage && usage.daily_limit < 999999 && (
          <div className="mb-2 space-y-1.5">
            <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  usagePct > 90 ? "bg-destructive" : "bg-primary"
                )}
                style={{ width: `${100 - usagePct}%` }}
              />
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span>
                {usage.remaining} / {usage.daily_limit} {t("messagesLeft")}
                {usage.subscription_tier && usage.subscription_tier !== "free" && (
                  <span className="ml-1 uppercase text-primary font-medium">
                    · {usage.subscription_tier}
                  </span>
                )}
              </span>
              {limitReached && (
                <>
                  <span className="text-destructive font-medium">
                    · {t("limitReached")}
                  </span>
                  <Link
                    href="/pricing"
                    className="text-primary font-medium hover:underline"
                  >
                    {t("upgradeShort")}
                  </Link>
                </>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div
          className={cn(
            "relative flex items-end gap-2 rounded-2xl border bg-background/80 backdrop-blur-xl shadow-soft transition-shadow",
            "border-border/80 focus-within:border-primary/40 focus-within:shadow-glow"
          )}
        >
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex gap-1 px-3 pt-2 pb-0 overflow-x-auto scrollbar-none">
              <span className="text-[10px] text-muted-foreground self-center mr-1 shrink-0">
                {t("persona")}
              </span>
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPersona(p.id)}
                  className={cn(
                    "shrink-0 rounded-lg px-2 py-0.5 text-[11px] transition",
                    persona === p.id
                      ? "bg-primary/20 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent/60"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              isCurrentGenerating
                ? t("waitingResponse")
                : limitReached
                ? t("dailyLimitReached")
                : t("messagePlaceholder")
            }
            disabled={disabled}
            rows={1}
            className={cn(
              "flex-1 resize-none bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
              "max-h-[200px]"
            )}
          />
          </div>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn(
              "mb-2 h-9 w-9 shrink-0 rounded-xl",
              listening && "text-primary animate-pulse"
            )}
            onClick={toggleVoice}
            disabled={disabled}
            title={t("voiceInput")}
          >
            {listening ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>

          {isCurrentGenerating ? (
            <Button
              size="icon"
              variant="secondary"
              className="mb-2 mr-2 h-9 w-9 shrink-0 rounded-xl"
              onClick={() => currentChatId && stopGenerating(currentChatId)}
              title={t("stop")}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="mb-2 mr-2 h-9 w-9 shrink-0 rounded-xl shadow-sm"
              onClick={handleSend}
              disabled={disabled || !text.trim()}
              title="Send"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </Button>
          )}
        </div>
        <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
          {t("disclaimer")}
        </p>
      </div>
    </div>
  );
}
