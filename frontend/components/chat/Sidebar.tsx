"use client";

import { useEffect, useState } from "react";
import { useChatStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  MessageSquarePlus,
  Search,
  Moon,
  Sun,
  PanelLeftClose,
  LogIn,
  LogOut,
  Loader2,
  Trash2,
  Settings,
  BookOpen,
  Pencil,
  CreditCard,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { mn, enUS } from "date-fns/locale";
import { KnowledgeBase } from "./KnowledgeBase";
import type { Locale } from "@/lib/i18n";

export function Sidebar() {
  const {
    chats,
    currentChatId,
    sidebarOpen,
    searchQuery,
    theme,
    locale,
    user,
    authLoaded,
    isLoadingChats,
    generating,
    t,
    loadChats,
    selectChat,
    createNewChat,
    deleteChat,
    renameChat,
    logout,
    setSidebarOpen,
    setSearchQuery,
    setTheme,
    setLocale,
  } = useChatStore();

  const isLoggedIn = !!user && !user.is_guest;

  const [mounted, setMounted] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    if (savedTheme) setTheme(savedTheme);
    else setTheme("dark");
    const savedLocale = localStorage.getItem("locale") as Locale | null;
    if (savedLocale === "en" || savedLocale === "mn") setLocale(savedLocale);
    const savedPersona = localStorage.getItem("persona");
    if (savedPersona) useChatStore.getState().setPersona(savedPersona);
    loadChats();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadChats(), 280);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Cancel pending delete when clicking elsewhere
  useEffect(() => {
    if (!pendingDeleteId) return;
    const onDoc = () => setPendingDeleteId(null);
    // delay so the confirming click doesn't immediately clear
    const t = setTimeout(() => document.addEventListener("click", onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDoc);
    };
  }, [pendingDeleteId]);

  const onDelete = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    // First click → visual confirm on row; second click → delete (no browser popup)
    if (pendingDeleteId !== chatId) {
      setPendingDeleteId(chatId);
      return;
    }
    setDeletingId(chatId);
    setPendingDeleteId(null);
    try {
      await deleteChat(chatId);
    } catch {
      toastError();
    } finally {
      setDeletingId(null);
    }
  };

  const toastError = () => {
    try {
      // lazy to avoid hard dep if sonner fails
      import("sonner").then(({ toast }) => toast.error(t("deleteFailed")));
    } catch {
      /* ignore */
    }
  };

  const dateLocale = locale === "mn" ? mn : enUS;

  if (!mounted) return null;

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed md:static z-50 flex h-full flex-col bg-sidebar/90 text-sidebar-foreground border-r border-border/70 backdrop-blur-xl transition-all duration-200 overflow-hidden",
          sidebarOpen ? "w-[280px]" : "w-0"
        )}
      >
        <div className="px-3 pt-3 pb-1 shrink-0">
          <div className="flex items-center gap-2.5 px-1 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-teal-700 text-primary-foreground shadow-soft">
              <span className="font-display text-[11px] font-bold tracking-tight">
                NK
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-sm font-semibold tracking-tight truncate">
                NKMZ Chat
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                Qwen3 8B · local
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-8 w-8"
              onClick={() => setSidebarOpen(false)}
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 h-10 rounded-xl border-border/60 bg-background/40 hover:bg-accent/70 hover:border-primary/30"
            onClick={() => {
              createNewChat();
              if (typeof window !== "undefined" && window.innerWidth < 768) {
                setSidebarOpen(false);
              }
            }}
          >
            <MessageSquarePlus className="h-4 w-4" />
            {t("newChat")}
          </Button>
        </div>

        <div className="px-3 pb-2 pt-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("searchChats")}
              className="pl-8 h-9 rounded-xl bg-background/50 border-border/60"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {isLoadingChats && chats.length === 0 && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoadingChats && chats.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8 px-2">
              {t("noConversations")}
            </p>
          )}
          {chats.map((chat) => {
            const isActive = currentChatId === chat.id;
            const isGen =
              !!generating[chat.id] &&
              (generating[chat.id].status === "thinking" ||
                generating[chat.id].status === "streaming");
            const isEditing = editingId === chat.id;
            return (
              <div
                key={chat.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (isEditing) return;
                  selectChat(chat.id);
                  if (typeof window !== "undefined" && window.innerWidth < 768) {
                    setSidebarOpen(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (!isEditing && e.key === "Enter") selectChat(chat.id);
                }}
                className={cn(
                  "w-full text-left rounded-xl px-3 py-2.5 text-sm mb-0.5 transition-all group relative cursor-pointer",
                  pendingDeleteId === chat.id
                    ? "bg-destructive/15 ring-1 ring-destructive/50"
                    : isActive
                    ? "bg-accent text-accent-foreground shadow-soft"
                    : "hover:bg-accent/50",
                  isGen && pendingDeleteId !== chat.id && "ring-1 ring-primary/35"
                )}
              >
                <div className="flex items-center gap-2 pr-12">
                  {isEditing ? (
                    <input
                      autoFocus
                      className="flex-1 min-w-0 bg-background border border-input rounded px-1.5 py-0.5 text-sm outline-none"
                      value={editTitle}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={async (e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          try {
                            await renameChat(chat.id, editTitle);
                            setEditingId(null);
                          } catch {
                            /* ignore */
                          }
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={async () => {
                        try {
                          if (editTitle.trim()) await renameChat(chat.id, editTitle);
                        } catch {
                          /* ignore */
                        }
                        setEditingId(null);
                      }}
                    />
                  ) : (
                    <div className="truncate font-medium flex-1">
                      {chat.title || t("newChatTitle")}
                    </div>
                  )}
                  {isGen && (
                    <span className="shrink-0 text-[10px] text-primary font-medium animate-pulse">
                      …
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(chat.updated_at), {
                    addSuffix: true,
                    locale: dateLocale,
                  })}
                </div>
                <div
                  className={cn(
                    "absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5",
                    pendingDeleteId === chat.id
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  )}
                >
                  {pendingDeleteId === chat.id ? (
                    <>
                      <button
                        type="button"
                        className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-destructive text-destructive-foreground"
                        onClick={(e) => onDelete(e, chat.id)}
                        disabled={deletingId === chat.id}
                      >
                        {deletingId === chat.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          t("deleteAction")
                        )}
                      </button>
                      <button
                        type="button"
                        className="px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:bg-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteId(null);
                        }}
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-accent text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(chat.id);
                          setEditTitle(chat.title || "");
                        }}
                        title="Rename"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                        onClick={(e) => onDelete(e, chat.id)}
                        disabled={deletingId === chat.id}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-border/70 p-3 space-y-1 shrink-0">
          <div className="flex gap-1 mb-1 rounded-xl bg-muted/40 p-0.5">
            <Button
              variant={locale === "mn" ? "secondary" : "ghost"}
              size="sm"
              className="flex-1 h-8 text-xs rounded-lg"
              onClick={() => setLocale("mn")}
            >
              Монгол
            </Button>
            <Button
              variant={locale === "en" ? "secondary" : "ghost"}
              size="sm"
              className="flex-1 h-8 text-xs rounded-lg"
              onClick={() => setLocale("en")}
            >
              English
            </Button>
          </div>
          {isLoggedIn && (
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 h-9 text-primary"
              onClick={() => (window.location.href = "/pricing")}
            >
              <CreditCard className="h-4 w-4" />
              {t("upgradePlan")}
            </Button>
          )}
          {isLoggedIn && user?.role === "admin" && (
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 h-9"
              onClick={() => setKbOpen(true)}
            >
              <BookOpen className="h-4 w-4" />
              {t("knowledgeBase")}
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 h-9"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
            {theme === "dark" ? t("lightMode") : t("darkMode")}
          </Button>
          {authLoaded && isLoggedIn ? (
            <div className="rounded-xl border border-border/70 bg-background/40 p-2.5 space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-teal-700 text-primary-foreground text-xs font-semibold">
                  {(user.full_name || user.email || "U").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {user.full_name || user.email || t("profile")}
                  </div>
                  {user.email && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {user.email}
                    </div>
                  )}
                </div>
              </div>
              {user?.role === "admin" && (
                <Button
                  variant="secondary"
                  className="w-full justify-start gap-2 h-8"
                  onClick={() => (window.location.href = "/admin")}
                >
                  <Settings className="h-4 w-4" />
                  {t("adminEnter")}
                </Button>
              )}
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 h-8 text-destructive hover:text-destructive"
                onClick={() => logout()}
              >
                <LogOut className="h-4 w-4" />
                {t("logout")}
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 h-9"
              onClick={() => (window.location.href = "/login")}
            >
              <LogIn className="h-4 w-4" />
              {t("loginRegister")}
            </Button>
          )}
        </div>
      </aside>

      <KnowledgeBase open={kbOpen} onClose={() => setKbOpen(false)} />
    </>
  );
}
