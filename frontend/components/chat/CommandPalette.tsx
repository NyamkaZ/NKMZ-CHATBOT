"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  MessageSquarePlus,
  Search,
  CreditCard,
  Moon,
  Sun,
  Download,
  Sparkles,
} from "lucide-react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const {
    createNewChat,
    setTheme,
    theme,
    t,
    currentChatId,
    messagesByChat,
    chats,
  } = useChatStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const exportChat = () => {
    if (!currentChatId) return;
    const msgs = messagesByChat[currentChatId] || [];
    const title = chats.find((c) => c.id === currentChatId)?.title || "chat";
    const body = msgs
      .map((m) => `## ${m.role}\n\n${m.content}\n`)
      .join("\n---\n\n");
    const blob = new Blob([`# ${title}\n\n${body}`], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\w\-]+/g, "_").slice(0, 40)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    setOpen(false);
  };

  const actions = [
    {
      id: "new",
      label: t("newChat"),
      icon: MessageSquarePlus,
      run: () => {
        createNewChat();
        setOpen(false);
      },
    },
    {
      id: "pricing",
      label: t("upgradePlan"),
      icon: CreditCard,
      run: () => {
        router.push("/pricing");
        setOpen(false);
      },
    },
    {
      id: "theme",
      label: theme === "dark" ? t("lightMode") : t("darkMode"),
      icon: theme === "dark" ? Sun : Moon,
      run: () => {
        setTheme(theme === "dark" ? "light" : "dark");
        setOpen(false);
      },
    },
    {
      id: "export",
      label: t("exportChat"),
      icon: Download,
      run: exportChat,
      disabled: !currentChatId,
    },
  ];

  const filtered = actions.filter((a) =>
    a.label.toLowerCase().includes(query.toLowerCase())
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border/80 bg-background/95 shadow-glow overflow-hidden animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={t("commandPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="hidden sm:inline text-[10px] text-muted-foreground border rounded px-1.5">
            esc
          </kbd>
        </div>
        <ul className="max-h-72 overflow-y-auto p-2">
          {filtered.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                disabled={a.disabled}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-left hover:bg-accent/80 disabled:opacity-40"
                )}
                onClick={a.run}
              >
                <a.icon className="h-4 w-4 text-primary" />
                {a.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("noResults")}
            </li>
          )}
        </ul>
        <div className="border-t border-border/70 px-4 py-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          {t("commandHint")}
        </div>
      </div>
    </div>
  );
}
