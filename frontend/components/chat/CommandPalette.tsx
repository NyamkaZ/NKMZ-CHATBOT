"use client";

import { memo, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { CreditCard, Download, MessageSquarePlus, Search, Smartphone, X } from "lucide-react";
import { useChatStore } from "@/lib/store";
import { translate } from "@/lib/i18n";
import { canInstall, promptInstall, subscribeInstall } from "@/lib/pwa";

function downloadConversation() {
  const { currentChatId, messagesByChat, currentChatTitle } = useChatStore.getState();
  if (!currentChatId || !messagesByChat[currentChatId]?.length) return;
  const title = currentChatTitle || "Chat";
  const turns = messagesByChat[currentChatId].map(message => `## ${message.role}\n\n${message.content}`);
  const blob = new Blob([[`# ${title}`, ...turns].join("\n\n---\n\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  // Preserve Cyrillic titles and strip characters that cannot be used in filenames.
  link.download = (title.replace(/[<>:"/\\|?*]/g, "_").trim().slice(0, 72) || "Chat") + ".md";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const CommandPalette = memo(function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const locale = useChatStore(s => s.locale);
  const canExport = useChatStore(s => !!s.currentChatId && !!s.messagesByChat[s.currentChatId]?.length);
  const installable = useSyncExternalStore(subscribeInstall, canInstall, () => false);
  const label = translate(locale, "quickActions");

  const changeOpen = (value: boolean) => {
    if (value) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery("");
      setHighlight(0);
    }
    setOpen(value);
  };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.defaultPrevented || event.altKey ||
          !(event.metaKey || event.ctrlKey) || (event.code !== "KeyK" && event.key.toLowerCase() !== "k")) return;
      if (!open && document.querySelector('[role="dialog"][data-state="open"]')) return;
      event.preventDefault();
      changeOpen(!open);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open]);

  const actions = [
    { id: "new", label: translate(locale, "newChat"), icon: MessageSquarePlus, run: useChatStore.getState().createNewChat },
    { id: "pricing", label: translate(locale, "upgradePlan"), icon: CreditCard, run: () => router.push("/pricing") },
    ...(canExport ? [{ id: "export", label: translate(locale, "exportChat"), icon: Download, run: downloadConversation }] : []),
    ...(installable ? [{ id: "install", label: translate(locale, "installApp"), icon: Smartphone, run: () => void promptInstall() }] : []),
  ];
  const filtered = actions.filter(action => action.label.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)));
  const index = Math.min(highlight, filtered.length - 1);
  const run = (action: typeof actions[number]) => {
    changeOpen(false);
    action.run();
  };

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      {/* No visible trigger: the palette opens with Ctrl+K / Cmd+K. */}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content aria-describedby={undefined}
          onOpenAutoFocus={e => { e.preventDefault(); input.current?.focus(); }}
          onCloseAutoFocus={e => { if (returnFocus.current?.isConnected) { e.preventDefault(); returnFocus.current.focus(); } }}
          className="fixed left-1/2 top-[max(4rem,15dvh)] z-[100] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 overflow-hidden rounded-2xl border border-white/15 bg-[#151515] text-neutral-100 shadow-2xl">
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <Search size={16} className="shrink-0 text-neutral-400" aria-hidden="true" />
            <input ref={input} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={true}
              aria-controls={listId} aria-activedescendant={index >= 0 ? listId + "-" + filtered[index].id : undefined}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
              placeholder={translate(locale, "commandPlaceholder")} value={query}
              onChange={e => { setQuery(e.target.value); setHighlight(0); }}
              onKeyDown={e => {
                if (e.nativeEvent.isComposing || !filtered.length) return;
                if (e.key === "Enter") { e.preventDefault(); run(filtered[index]); }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((index + (e.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length);
                }
              }} />
            <Dialog.Close aria-label={locale === "mn" ? "Хаах" : "Close"}
              className="rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white">
              <X size={15} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <ul role="listbox" id={listId} aria-label={label} className="max-h-[50dvh] overflow-y-auto p-2">
            {filtered.map((action, i) => (
              <li key={action.id} role="option" id={listId + "-" + action.id} aria-selected={index === i}
                onPointerMove={() => setHighlight(i)} onMouseDown={e => e.preventDefault()} onClick={() => run(action)}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-sm aria-selected:bg-white/10">
                <action.icon size={16} aria-hidden="true" className="text-neutral-400" />
                {action.label}
              </li>
            ))}
          </ul>
          {!filtered.length && <p role="status" className="px-4 pb-5 text-sm text-neutral-400">{translate(locale, "noResults")}</p>}
          <p className="hidden border-t border-white/10 px-4 py-2 text-[11px] text-neutral-400 sm:block">{translate(locale, "commandHint")}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});

