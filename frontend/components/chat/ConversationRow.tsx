"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { enUS, mn } from "date-fns/locale";
import { useChatStore, type Chat } from "@/lib/store";
import { translate, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Action = "rename" | "delete";
type Props = {
  chat: Chat;
  active: boolean;
  locale: Locale;
  onSelect: (id: string) => void;
  onDeleted: () => void;
};

const iconButton = "inline-flex h-9 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 disabled:opacity-40";

export const ConversationRow = memo(function ConversationRow({ chat, active, locale, onSelect, onDeleted }: Props) {
  const generating = useChatStore(s => {
    const status = s.generating[chat.id]?.status;
    return status === "thinking" || status === "streaming";
  });
  const [action, setAction] = useState<Action | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const editing = useRef(false);
  const row = useRef<HTMLLIElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const mongolian = locale === "mn";
  const title = chat.title || translate(locale, "newChatTitle");
  const renameLabel = mongolian ? "Нэр солих" : "Rename";
  const cancelLabel = mongolian ? "Болих" : "Cancel";
  const saveLabel = mongolian ? "Хадгалах" : "Save";
  const deleteLabel = translate(locale, "deleteAction");
  const pinLabel = translate(locale, chat.is_pinned ? "unpin" : "pin");

  async function togglePin() {
    if (pending.current) return;
    pending.current = true;
    try {
      await useChatStore.getState().pinChat(chat.id, !chat.is_pinned);
    } catch {
      toast.error(translate(locale, "pinFailed"));
    } finally {
      pending.current = false;
    }
  }

  useEffect(() => {
    if (action === "rename") { input.current?.focus(); input.current?.select(); }
    if (action === "delete") cancel.current?.focus();
  }, [action]);

  function begin(next: Action) {
    setError("");
    setDraft(chat.title);
    editing.current = next === "rename";
    setAction(next);
  }

  function finish(restoreFocus: boolean) {
    editing.current = false;
    setAction(null);
    if (restoreFocus) {
      const trigger = action === "delete" ? deleteButton : editButton;
      requestAnimationFrame(() => trigger.current?.focus());
    }
  }

  async function save(restoreFocus: boolean) {
    if (!editing.current || pending.current) return;
    const title = draft.trim();
    if (!title || title === chat.title) { finish(restoreFocus); return; }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await useChatStore.getState().renameChat(chat.id, title);
      const focusStillInside = document.activeElement === document.body || row.current?.contains(document.activeElement);
      finish(restoreFocus && !!focusStillInside);
    } catch {
      setError(mongolian ? "Нэрийг хадгалж чадсангүй. Дахин оролдоно уу." : "Couldn’t save the name. Try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await useChatStore.getState().deleteChat(chat.id);
      if (document.activeElement === document.body || row.current?.contains(document.activeElement)) onDeleted();
    } catch {
      setError(translate(locale, "deleteFailed"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <li ref={row} className={cn("group relative rounded-xl text-sm transition-colors",
      active ? "bg-white/[0.07] text-white before:absolute before:inset-y-4 before:left-0 before:w-[2px] before:rounded-full before:bg-neutral-300" : "text-neutral-300 hover:bg-white/[0.045]")}>
      {action ? (
        <form data-chat-row-action className="space-y-2 rounded-xl border border-white/15 bg-neutral-900 p-3"
          onSubmit={e => { e.preventDefault(); if (action === "rename") void save(true); else void remove(); }}
          onKeyDown={e => {
            if (e.key === "Escape" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.stopPropagation();
              if (!pending.current) finish(true);
            }
          }}
          onBlur={e => {
            if (!e.relatedTarget || e.currentTarget.contains(e.relatedTarget) || pending.current) return;
            if (action === "rename") void save(false);
            else finish(false);
          }}
        >
          {action === "rename" ? (
            <div className="flex items-center gap-1">
              <input ref={input} aria-label={renameLabel} value={draft} maxLength={255} readOnly={busy}
                className="h-9 w-full min-w-0 rounded-lg border border-white/20 bg-neutral-950 px-2 text-neutral-100 outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
                onChange={e => setDraft(e.target.value)}
              />
              <button type="submit" disabled={busy || !draft.trim()} aria-label={saveLabel} title={saveLabel} className={iconButton}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
              <button type="button" disabled={busy} onClick={() => finish(true)} aria-label={cancelLabel} title={cancelLabel} className={iconButton}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <p className="break-words leading-snug">{mongolian ? `“${title}” чатыг устгах уу?` : `Delete “${title}”?`}</p>
              <div className="flex gap-2">
                <button ref={cancel} type="button" disabled={busy} onClick={() => finish(true)}
                  className="rounded-lg border border-white/20 px-3 py-2 text-xs hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-neutral-300">{cancelLabel}</button>
                <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-red-900 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-neutral-300">
                  {busy && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}{deleteLabel}
                </button>
              </div>
            </>
          )}
          {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        </form>
      ) : (
        <div className="flex items-center">
          <button type="button" aria-current={active ? "true" : undefined} title={title} onClick={() => onSelect(chat.id)}
            className="min-w-0 flex-1 rounded-xl py-2.5 pl-3 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-300">
            <span className="block truncate text-[13px] font-medium leading-5">{title}</span>
            <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-neutral-400">
              {generating && <span role="status"><Loader2 aria-hidden className="h-3 w-3 animate-spin motion-reduce:animate-none" /><span className="sr-only">{translate(locale, "generating")}</span></span>}
              {chat.is_pinned && <Pin aria-hidden className="h-2.5 w-2.5 shrink-0 text-neutral-400" />}<time className="truncate" dateTime={chat.updated_at}>{formatDistanceToNow(new Date(chat.updated_at), { addSuffix: true, locale: mongolian ? mn : enUS })}</time>
            </span>
          </button>
          <div className={cn("flex shrink-0 items-center pr-1.5", !active && "[@media(hover:hover)]:opacity-0 group-hover:!opacity-100 group-focus-within:!opacity-100")}>
            <button type="button" className={cn(iconButton, chat.is_pinned && "text-neutral-100")} onClick={() => void togglePin()}
              aria-pressed={!!chat.is_pinned} aria-label={`${pinLabel}: ${title}`} title={pinLabel}>
              {chat.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
            <button ref={editButton} type="button" className={iconButton} onClick={() => begin("rename")} aria-label={`${renameLabel}: ${title}`} title={renameLabel}><Pencil className="h-3.5 w-3.5" /></button>
            <button ref={deleteButton} type="button" className={cn(iconButton, "hover:bg-destructive/15 hover:text-red-300")} onClick={() => begin("delete")} aria-label={`${deleteLabel}: ${title}`} title={deleteLabel}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
    </li>
  );
});
