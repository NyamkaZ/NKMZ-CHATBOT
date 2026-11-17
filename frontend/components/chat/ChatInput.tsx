"use client";

import { memo, useState, useReducer, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { useChatStore } from "@/lib/store";
import { friendlyError } from "@/lib/errors";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ArrowUp, Check, ChevronDown, Mic, MicOff, SlidersHorizontal, Square } from "lucide-react";
import Link from "next/link";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";
import ElectricBorder from "@/components/react-bits/ElectricBorder";
import { composerDrafts, type ComposerDraft, type DraftKey } from "./composerDrafts";
import { formatCountdown } from "@/lib/countdown";
import { remainingPercent } from "@/lib/usage";
import { useRemaining } from "./useRemaining";
import styles from "./ChatInput.module.css";

const PERSONAS = [
  { id: "default", en: "Assistant", mn: "Туслах" },
  { id: "coder", en: "Code", mn: "Код" },
  { id: "tutor", en: "Tutor", mn: "Багш" },
  { id: "creative", en: "Creative", mn: "Бүтээлч" },
  { id: "analyst", en: "Analyst", mn: "Шинжээч" },
];

interface VoiceRecognition {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type VoiceConstructor = new () => VoiceRecognition;

export const ChatInput = memo(function ChatInput() {
  const [session, setSession] = useState(0);
  // Discard drafts and in-flight callbacks when an established account signs out.
  // The initial guest/session lookup can finish after the user has started typing.
  useEffect(() => useChatStore.subscribe((next, previous) => {
    if (previous.user && next.user?.id !== previous.user.id) setSession(value => value + 1);
  }), []);
  return <Composer key={session} />;
});

function Composer() {
  const [drafts, dispatch] = useReducer(composerDrafts, new Map<DraftKey, ComposerDraft>());
  const [listening, setListening] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<VoiceRecognition | null>(null);
  const {
    currentChatId,
    dashboard,
    isCurrentGenerating,
    waitingForHistory,
    isSending,
    usage,
    sendMessage,
    stopGenerating,
    persona,
    setPersona,
    t,
    locale,
  } = useChatStore(useShallow(s => ({
    currentChatId: s.currentChatId,
    dashboard: !s.currentChatId || s.messagesByChat[s.currentChatId]?.length === 0,
    waitingForHistory: !!s.currentChatId && s.messagesByChat[s.currentChatId] === undefined,
    isCurrentGenerating: !!s.currentChatId && !!s.generating[s.currentChatId],
    isSending: s.isSending, usage: s.usage, sendMessage: s.sendMessage,
    stopGenerating: s.stopGenerating, persona: s.persona, setPersona: s.setPersona,
    t: s.t, locale: s.locale,
  })));

  const limitReached = usage !== null && usage.remaining <= 0;
  const draft = drafts.get(currentChatId);
  const text = draft?.text ?? "";
  const failure = draft?.failure;
  const sendDisabled = isSending || isCurrentGenerating || limitReached || waitingForHistory;
  // A rate-limited send can be retried once the server's wait has passed.
  const retryIn = useRemaining((failure?.cause as { retryAt?: number } | undefined)?.retryAt);
  // The daily allowance refills at the time the server reports.
  const resetAt = limitReached && usage?.resets_at ? Date.parse(usage.resets_at) : null;
  const resetIn = useRemaining(resetAt);
  useEffect(() => {
    if (resetAt && resetIn === 0 && Date.now() >= resetAt) void useChatStore.getState().loadUsage();
  }, [resetAt, resetIn]);
  // A new chat has no server ID to attach a follow-up to until the first send returns.
  const awaitingFirstMessage = !currentChatId && isSending;

  const abortVoice = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    recognitionRef.current = null;
    rec.abort();
    setListening(false);
  }, []);
  useEffect(() => abortVoice, [currentChatId, locale, abortVoice]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [text]);

  const handleSend = async (submitted = text, keepText = false) => {
    const content = submitted.trim();
    const latest = useChatStore.getState();
    if (!content || sendDisabled || latest.isSending || latest.currentChatId !== currentChatId ||
        (currentChatId && latest.generating[currentChatId])) return;
    abortVoice();
    dispatch({ type: "send", key: currentChatId, keepText });
    try {
      await sendMessage(content);
      dispatch({ type: "sent", key: currentChatId });
    } catch (cause) {
      dispatch({ type: "failed", key: currentChatId, text: submitted, cause });
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  const toggleVoice = () => {
    if (recognitionRef.current) {
      recognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as Window & { SpeechRecognition?: VoiceConstructor; webkitSpeechRecognition?: VoiceConstructor };
    const SR = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SR) {
      toast.error(locale === "mn" ? "Энэ хөтөч дуугаар бичихийг дэмждэггүй." : "This browser doesn’t support voice input.");
      return;
    }
    const rec = new SR();
    recognitionRef.current = rec;
    rec.lang = locale === "mn" ? "mn-MN" : "en-US";
    rec.interimResults = true;
    rec.onresult = event => {
      if (recognitionRef.current !== rec || useChatStore.getState().currentChatId !== currentChatId) return;
      const transcript = Array.from(event.results, result => result[0].transcript).join(" ").trim();
      const separator = text && transcript && !/\s$/.test(text) ? " " : "";
      dispatch({ type: "edit", key: currentChatId, text: (text + separator + transcript).slice(0, 32000) });
    };
    const finish = () => {
      if (recognitionRef.current !== rec) return;
      recognitionRef.current = null;
      setListening(false);
    };
    rec.onend = finish;
    rec.onerror = event => {
      if (recognitionRef.current !== rec) return;
      finish();
      if (event.error !== "aborted") toast.error(locale === "mn" ? "Микрофоноо шалгаад дахин оролдоорой." : "Check your microphone and try again.");
    };
    try {
      rec.start();
      setListening(true);
    } catch {
      finish();
      toast.error(locale === "mn" ? "Микрофоныг асааж чадсангүй." : "Couldn’t start the microphone.");
    }
  };

  const selectedPersona = PERSONAS.find(option => option.id === persona) ?? PERSONAS[0];
  const modeLabel = locale === "mn" ? "Хариулах горим" : "Response mode";
  const sendLabel = locale === "mn" ? "Мессеж илгээх" : "Send message";
  const voiceLabel = listening
    ? (locale === "mn" ? "Дуугаар бичихийг зогсоох" : "Stop voice input")
    : t("voiceInput");
  const showUsage = usage !== null && usage.daily_limit < 999999;
  // People see their allowance as a percentage, never as message counts.
  const remainingPct = usage ? remainingPercent(usage.remaining, usage.daily_limit) : 0;

  return (
    <div className={styles.dock}>
      <div className={styles.inner} data-dashboard={dashboard || undefined}>
        {failure && (
          <div className={styles.failure}>
            <div role="alert" className="min-w-0">
              {friendlyError(failure.cause, locale, "sendFailed")}
              {failure.text !== text && <p className="mt-1 truncate text-neutral-400">{failure.text}</p>}
            </div>
            <button type="button" disabled={sendDisabled || retryIn > 0}
              onClick={() => void handleSend(failure.text, text !== failure.text)}>
              {t("retry")}{retryIn > 0 && <span className="tabular-nums"> ({formatCountdown(retryIn)})</span>}
            </button>
          </div>
        )}
        <ElectricBorder
          active={composerFocused || isCurrentGenerating}
          color="#b8b8b8"
          glowColor="#ededed"
          speed={0.52}
          chaos={0.18}
          spread={0.2}
          thickness={0.85}
          strands={2}
          glow={0.32}
          intensity={0.46}
          arcs={0}
          flicker={0.06}
          borderRadius={18}
        >
          <form className={styles.panel} aria-label={locale === "mn" ? "Мессеж бичих" : "Compose a message"}
            onFocus={() => setComposerFocused(true)}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setComposerFocused(false); }}
            onSubmit={event => { event.preventDefault(); void handleSend(); }}>
            <textarea
              className={styles.input}
              ref={textareaRef}
              value={text}
              onChange={event => {
                abortVoice();
                dispatch({ type: "edit", key: currentChatId, text: event.target.value });
              }}
              onKeyDown={onKeyDown}
              placeholder={
                limitReached ? t("dailyLimitReached")
                  : awaitingFirstMessage ? t("pleaseWait")
                  : isCurrentGenerating ? (locale === "mn" ? "Дараагийн мессежээ бичих…" : "Draft your next message…")
                  : t("messagePlaceholder")
              }
              readOnly={awaitingFirstMessage}
              rows={1}
              aria-label={t("messagePlaceholder")}
              maxLength={32000}
            />
            <div className={styles.toolbar}>
              <Menu.Root modal={false}>
                <Menu.Trigger type="button" className={styles.mode} aria-label={`${modeLabel}: ${selectedPersona[locale]}`}>
                  <SlidersHorizontal aria-hidden="true" size={14} />
                  {selectedPersona[locale]}
                  <ChevronDown aria-hidden="true" size={13} />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content className={styles.menu} side="top" align="start" sideOffset={8}
                    collisionPadding={12} aria-label={modeLabel}>
                    <Menu.Label className={styles.menuLabel}>{modeLabel}</Menu.Label>
                    <Menu.RadioGroup value={selectedPersona.id} onValueChange={setPersona}>
                      {PERSONAS.map(option => (
                        <Menu.RadioItem key={option.id} value={option.id} className={styles.option}>
                          {option[locale]}
                          <Menu.ItemIndicator><Check aria-hidden="true" size={15} /></Menu.ItemIndicator>
                        </Menu.RadioItem>
                      ))}
                    </Menu.RadioGroup>
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
              <div className={styles.actions}>
                <button type="button" className={styles.voice} onClick={toggleVoice}
                  disabled={awaitingFirstMessage} title={voiceLabel} aria-label={voiceLabel} aria-pressed={listening}>
                  {listening ? <MicOff aria-hidden="true" size={18} /> : <Mic aria-hidden="true" size={18} />}
                </button>
                {isCurrentGenerating ? (
                  <LiquidMetalButton key="stop" viewMode="icon" size={40}
                    onClick={() => currentChatId && stopGenerating(currentChatId)} title={t("stop")} aria-label={t("stop")}>
                    <Square aria-hidden="true" size={13} fill="currentColor" />
                  </LiquidMetalButton>
                ) : (
                  <LiquidMetalButton key="send" type="submit" viewMode="icon" size={40}
                    disabled={sendDisabled || !text.trim()} title={sendLabel} aria-label={sendLabel}>
                    <ArrowUp aria-hidden="true" size={19} strokeWidth={2.25} />
                  </LiquidMetalButton>
                )}
              </div>
            </div>
          </form>
        </ElectricBorder>
        <div className={styles.footnote}>
          <p className={styles.disclaimer}>{t("disclaimer")}</p>
          {showUsage && (
            <div className={styles.quota} data-low={remainingPct <= 10 || undefined}>
              <span aria-hidden="true" className={styles.meter}><i style={{ width: `${remainingPct}%` }} /></span>
              <span>{remainingPct}% {t("usageLeft")}</span>
              {usage.subscription_tier && usage.subscription_tier !== "free" && (
                <span className={styles.tier}>{usage.subscription_tier}</span>
              )}
              {resetIn > 0 && <span role="timer">{t("resetsIn")} {formatCountdown(resetIn)}</span>}
              {limitReached && <Link href="/pricing">{locale === "mn" ? "Багц ахиулах" : t("upgradeShort")}</Link>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
