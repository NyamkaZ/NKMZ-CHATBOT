import { create } from "zustand";
import { api } from "./api";
import type { Locale, TranslationKey } from "./i18n";
import { translate } from "./i18n";

let guestRequest: Promise<void> | null = null;
let authVersion = 0;
let chatListRequest = 0;
let historyRequest = 0;

/** Pinned conversations first, then most recently updated. Mirrors the server order. */
export function sortChats<T extends { is_pinned?: boolean; updated_at: string }>(chats: T[]): T[] {
  return [...chats].sort((a, b) =>
    Number(!!b.is_pinned) - Number(!!a.is_pinned) || (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

function closeStreams() {
  Object.values(useChatStore.getState().generating).forEach((g) => g.eventSource?.close());
}

export type MessageStatus =
  | "pending"
  | "thinking"
  | "streaming"
  | "completed"
  | "stopped"
  | "failed";

export interface Message {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: MessageStatus;
  generation_id?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chat {
  id: string;
  title: string;
  is_title_generated: boolean;
  is_pinned?: boolean;
  updated_at: string;
  messages?: Message[];
}

export interface Usage {
  daily_limit: number;
  used_today: number;
  remaining: number;
  resets_at?: string | null;
  subscription_tier?: string;
}

export interface AuthUser {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role: string;
  is_guest: boolean;
  is_active?: boolean;
  email_verified?: boolean;
}

interface GeneratingState {
  chatId: string;
  messageId: string;
  generationId: string;
  content: string;
  status: MessageStatus;
  eventSource?: EventSource | null;
}

interface ChatState {
  chats: Chat[];
  currentChatId: string | null;
  currentChatTitle: string | null;
  messagesByChat: Record<string, Message[]>;
  generating: Record<string, GeneratingState>;
  usage: Usage | null;
  user: AuthUser | null;
  authLoaded: boolean;
  isLoadingChats: boolean;
  chatListError: boolean;
  historyError: boolean;
  isSending: boolean;
  searchQuery: string;
  sidebarOpen: boolean;
  theme: "light" | "dark";
  locale: Locale;
  persona: string;

  setTheme: (t: "light" | "dark") => void;
  setPersona: (p: string) => void;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey) => string;
  setSidebarOpen: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  loadAuth: () => Promise<void>;
  resetSession: () => void;
  logout: () => void;
  loadChats: () => Promise<void>;
  selectChat: (chatId: string | null) => Promise<void>;
  createNewChat: () => void;
  deleteChat: (chatId: string) => Promise<void>;
  renameChat: (chatId: string, title: string) => Promise<void>;
  pinChat: (chatId: string, pinned: boolean) => Promise<void>;
  updateProfile: (fullName: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  stopGenerating: (chatId: string) => Promise<void>;
  regenerate: (chatId: string, messageId: string) => Promise<void>;
  loadUsage: () => Promise<void>;
  ensureGuest: () => Promise<void>;
  updateMessageContent: (
    chatId: string,
    messageId: string,
    content: string,
    status?: MessageStatus,
    error?: string | null
  ) => void;
  updateChatTitle: (chatId: string, title: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  currentChatId: null,
  currentChatTitle: null,
  messagesByChat: {},
  generating: {},
  usage: null,
  user: null,
  authLoaded: false,
  isLoadingChats: false,
  chatListError: false,
  historyError: false,
  isSending: false,
  searchQuery: "",
  sidebarOpen: false,
  theme: "dark",
  locale: "mn",
  persona: "default",

  setPersona: (p) => {
    set({ persona: p });
    if (typeof window !== "undefined") localStorage.setItem("persona", p);
  },

  setTheme: () => {
    set({ theme: "dark" });
    if (typeof document !== "undefined") {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    }
  },

  setLocale: (l) => {
    set({ locale: l });
    if (typeof window !== "undefined") {
      try { localStorage.setItem("locale", l); } catch { /* Private browsing may disable storage. */ }
    }
  },

  t: (key) => translate(get().locale, key),

  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  loadAuth: async () => {
    const version = authVersion;
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("access_token");
    if (!token && !localStorage.getItem("guest_id")) {
      set({ user: null, authLoaded: true });
      return;
    }
    try {
      const me = (await api.me()) as AuthUser;
      if (version !== authVersion) return;
      if (get().user && get().user?.id !== me.id) {
        get().resetSession();
      }
      set({ user: me, authLoaded: true });
    } catch (error) {
      if (version !== authVersion) return;
      if ((error as { status?: number }).status === 401) {
        get().resetSession();
        localStorage.removeItem("access_token");
        localStorage.removeItem("guest_id");
      }
      set({ authLoaded: true });
    }
  },

  resetSession: () => {
    authVersion++;
    guestRequest = null;
    closeStreams();
    set({
      user: null,
      chats: [],
      currentChatId: null,
      currentChatTitle: null,
      messagesByChat: {},
      generating: {},
      isSending: false,
      isLoadingChats: false,
      chatListError: false,
      historyError: false,
      searchQuery: "",
      usage: null,
      authLoaded: true,
    });
  },

  logout: () => {
    get().resetSession();
    if (typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      localStorage.removeItem("guest_id");
      localStorage.setItem("auth_logout", String(Date.now()));
    }
    const version = authVersion;
    void get().ensureGuest().then(() => {
      if (version !== authVersion) return;
      return Promise.all([get().loadAuth(), get().loadChats(), get().loadUsage()]);
    }).catch(() => {
      if (version === authVersion) set({ chatListError: true });
    });
  },

  ensureGuest: async () => {
    if (typeof window === "undefined") return;
    // If we have a real logged-in user, do not create guest
    const existingUser = get().user;
    if (existingUser && !existingUser.is_guest) return;

    if (localStorage.getItem("access_token") || localStorage.getItem("guest_id")) {
      return;
    }
    if (guestRequest) return guestRequest;
    guestRequest = (async () => {
      const version = authVersion;
      try {
        const data = await api.createGuest();
        if (version !== authVersion || localStorage.getItem("access_token")) return;
        localStorage.setItem("guest_id", data.guest_id);
        if (data.access_token) localStorage.setItem("access_token", data.access_token);
      } finally {
        if (version === authVersion) guestRequest = null;
      }
    })();
    return guestRequest;
  },

  loadChats: async () => {
    const version = authVersion;
    const request = ++chatListRequest;
    const query = get().searchQuery;
    set({ isLoadingChats: true, chatListError: false });
    try {
      await get().ensureGuest();
      if (version !== authVersion || request !== chatListRequest || query !== get().searchQuery) return;
      const list = (await api.listChats(query || undefined)) as Chat[];
      if (version !== authVersion || request !== chatListRequest || query !== get().searchQuery) return;
      set({ chats: list });
    } catch (e) {
      if (version === authVersion && request === chatListRequest && query === get().searchQuery) {
        set({ chatListError: true });
      }
    } finally {
      if (version === authVersion && request === chatListRequest) set({ isLoadingChats: false });
    }
  },

  selectChat: async (chatId) => {
    const version = authVersion;
    const request = ++historyRequest;
    const summary = get().chats.find(chat => chat.id === chatId);
    const selectedTitle = summary?.title ?? (get().currentChatId === chatId ? get().currentChatTitle : null);
    set({ currentChatId: chatId, currentChatTitle: selectedTitle, historyError: false });
    if (!chatId) return;

    const existing = get().messagesByChat[chatId];
    const running = get().generating[chatId];
    if (running && existing && ["pending", "thinking", "streaming"].includes(running.status)) {
      if (!running.eventSource || running.eventSource.readyState === EventSource.CLOSED) {
        attachStream(chatId, running.generationId, running.messageId, running.content);
      }
      return;
    }

    const stillCurrent = () => version === authVersion && request === historyRequest &&
      get().currentChatId === chatId && get().messagesByChat[chatId] === existing;
    try {
      const chat = (await api.getChat(chatId)) as Chat & { messages: Message[] };
      // A late refresh must not remove a turn added after the request started.
      if (!stillCurrent()) return;
      set((s) => ({
        currentChatTitle: s.currentChatTitle === selectedTitle ? chat.title : s.currentChatTitle,
        messagesByChat: { ...s.messagesByChat, [chatId]: chat.messages },
        chats: s.chats.map(item => item === summary
          ? { ...item, title: chat.title, updated_at: chat.updated_at, is_title_generated: chat.is_title_generated, is_pinned: chat.is_pinned }
          : item),
      }));

      const last = chat.messages.findLast(message => message.role === "assistant");
      if (last?.generation_id && ["pending", "thinking", "streaming"].includes(last.status)) {
        attachStream(chatId, last.generation_id, last.id, last.content);
      }
    } catch {
      if (stillCurrent()) set({ historyError: true });
    }
  },

  createNewChat: () => {
    historyRequest++;
    set({ currentChatId: null, currentChatTitle: null, historyError: false });
  },

  deleteChat: async (chatId: string) => {
    const version = authVersion;
    await api.deleteChat(chatId); // The server also stops any active generation.
    if (version !== authVersion) return;
    get().generating[chatId]?.eventSource?.close();
    set((s) => {
      const { [chatId]: _m, ...messagesByChat } = s.messagesByChat;
      const { [chatId]: _g, ...generating } = s.generating;
      return {
        chats: s.chats.filter((c) => c.id !== chatId),
        messagesByChat,
        generating,
        currentChatId: s.currentChatId === chatId ? null : s.currentChatId,
        currentChatTitle: s.currentChatId === chatId ? null : s.currentChatTitle,
      };
    });
    if (get().isLoadingChats) void get().loadChats();
  },

  renameChat: async (chatId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await api.renameChat(chatId, trimmed);
    get().updateChatTitle(chatId, trimmed);
  },

  pinChat: async (chatId, pinned) => {
    const version = authVersion;
    const apply = (value: boolean) => set((s) => ({
      chats: sortChats(s.chats.map((c) => (c.id === chatId ? { ...c, is_pinned: value } : c))),
    }));
    apply(pinned); // optimistic: the row moves immediately
    try {
      await api.pinChat(chatId, pinned);
    } catch (error) {
      if (version === authVersion) apply(!pinned);
      throw error;
    }
  },

  updateProfile: async (fullName) => {
    const version = authVersion;
    const me = (await api.updateProfile(fullName)) as AuthUser;
    if (version === authVersion) set({ user: me });
  },

  updateMessageContent: (chatId, messageId, content, status, error) => {
    set((s) => {
      const msgs = s.messagesByChat[chatId] || [];
      const updated = msgs.map((m) =>
        m.id === messageId
          ? {
              ...m,
              content,
              status: status || m.status,
              error_message: error !== undefined ? error : m.error_message,
              updated_at: new Date().toISOString(),
            }
          : m
      );
      return { messagesByChat: { ...s.messagesByChat, [chatId]: updated } };
    });
  },

  updateChatTitle: (chatId, title) => {
    set((s) => ({
      currentChatTitle: s.currentChatId === chatId ? title : s.currentChatTitle,
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, title, is_title_generated: true } : c
      ),
    }));
  },

  sendMessage: async (content: string) => {
    const version = authVersion;
    const selection = historyRequest;
    const { currentChatId, generating, isSending } = get();
    if (isSending || (currentChatId && generating[currentChatId])) return;
    if (currentChatId && !get().messagesByChat[currentChatId]) throw new Error(get().t("historyUnavailable"));

    set({ isSending: true });
    try {
      await get().ensureGuest();
      if (version !== authVersion) return;
      const persona = get().persona;
      const data: any = await api.sendMessage(
        content,
        currentChatId || undefined,
        persona
      );
      if (version !== authVersion || (currentChatId && !get().messagesByChat[currentChatId])) return;
      const chat = data.chat as Chat;
      const userMsg = data.user_message as Message;
      const asstMsg = data.assistant_message as Message;
      const usage = data.usage as Usage | undefined;

      set((s) => {
        const prev = s.messagesByChat[chat.id] || [];
        // Avoid duplicates if optimistic UI ever added
        const withoutDup = prev.filter(
          (m) => m.id !== userMsg.id && m.id !== asstMsg.id
        );
        const msgs = [...withoutDup, userMsg, asstMsg];
        const chats = s.chats.some((c) => c.id === chat.id)
          ? s.chats.map((c) =>
              c.id === chat.id
                ? { ...c, title: chat.title, updated_at: chat.updated_at }
                : c
            )
          : [
              {
                id: chat.id,
                title: chat.title,
                is_title_generated: chat.is_title_generated,
                updated_at: chat.updated_at,
              },
              ...s.chats,
            ];
        const openSentChat = s.currentChatId === currentChatId && selection === historyRequest;
        return {
          currentChatId: openSentChat ? chat.id : s.currentChatId,
          currentChatTitle: openSentChat ? chat.title : s.currentChatTitle,
          messagesByChat: { ...s.messagesByChat, [chat.id]: msgs },
          chats: s.searchQuery ? chats : sortChats(chats),
          usage: usage || s.usage,
        };
      });

      if (asstMsg.generation_id && ["pending", "thinking", "streaming"].includes(asstMsg.status)) {
        attachStream(chat.id, asstMsg.generation_id, asstMsg.id, "");
      }
    } finally {
      if (version === authVersion) set({ isSending: false });
    }
  },

  stopGenerating: async (chatId: string) => {
    const gen = get().generating[chatId];
    if (!gen) return;
    try {
      await api.stopGeneration(chatId, gen.messageId);
      // Keep the stream attached until the server confirms the final content.
    } catch (e) {
      console.error(e);
    }
  },

  regenerate: async (chatId: string, messageId: string) => {
    const version = authVersion;
    if (get().isSending || get().generating[chatId]) return;
    set({ isSending: true });
    try {
      const data: any = await api.regenerate(chatId, messageId, get().persona);
      if (version !== authVersion) return;
      const asstMsg = data.assistant_message as Message;
      set((s) => {
        const msgs = (s.messagesByChat[chatId] || []).map((m) =>
          m.id === messageId
            ? { ...asstMsg, content: "", status: "thinking" as MessageStatus }
            : m
        );
        return {
          messagesByChat: { ...s.messagesByChat, [chatId]: msgs },
          usage: data.usage || s.usage,
        };
      });
      if (asstMsg.generation_id) {
        attachStream(chatId, asstMsg.generation_id, asstMsg.id, "");
      }
    } finally {
      if (version === authVersion) set({ isSending: false });
    }
  },

  loadUsage: async () => {
    const version = authVersion;
    try {
      const u = (await api.getUsage()) as Usage;
      if (version !== authVersion) return;
      set({ usage: u });
    } catch {
      /* guests / unauth */
    }
  },
}));

/** Attach or re-attach an EventSource for a generation. Safe to call repeatedly. */
function attachStream(
  chatId: string,
  generationId: string,
  messageId: string,
  initialContent = ""
) {
  const prev = useChatStore.getState().generating[chatId];
  if (prev?.eventSource) {
    try {
      prev.eventSource.close();
    } catch {
      /* ignore */
    }
  }

  const url = api.streamUrl(generationId);
  const es = new EventSource(url);
  let content = initialContent;
  const isCurrent = () => useChatStore.getState().generating[chatId]?.eventSource === es;

  const setGen = (partial: Partial<GeneratingState>) => {
    useChatStore.setState((s) => ({
      generating: {
        ...s.generating,
        [chatId]: {
          chatId,
          messageId,
          generationId,
          content,
          status: "streaming",
          eventSource: es,
          ...partial,
        },
      },
    }));
  };

  setGen({ status: "thinking", content });

  const onThinking = () => {
    if (!isCurrent()) return;
    setGen({ status: "thinking" });
    useChatStore
      .getState()
      .updateMessageContent(chatId, messageId, content, "thinking");
  };

  const onStatus = (e: MessageEvent) => {
    if (!isCurrent()) return;
    try {
      const data = JSON.parse(e.data);
      if (data.status === "streaming") {
        setGen({ status: "streaming" });
        useChatStore
          .getState()
          .updateMessageContent(chatId, messageId, content, "streaming");
      }
    } catch {
      /* ignore */
    }
  };

  const onCatchup = (e: MessageEvent) => {
    if (!isCurrent()) return;
    try {
      const data = JSON.parse(e.data);
      content = data.content ?? content;
      const st = (data.status as MessageStatus) || "streaming";
      setGen({ content, status: st });
      useChatStore.getState().updateMessageContent(chatId, messageId, content, st);
    } catch {
      /* ignore */
    }
  };

  const onToken = (e: MessageEvent) => {
    if (!isCurrent()) return;
    try {
      const data = JSON.parse(e.data);
      content += data.token || "";
      setGen({ content, status: "streaming" });
      useChatStore
        .getState()
        .updateMessageContent(chatId, messageId, content, "streaming");
    } catch {
      /* ignore */
    }
  };

  const onTitle = (e: MessageEvent) => {
    if (!isCurrent()) return;
    try {
      const data = JSON.parse(e.data);
      if (data.title && data.chat_id) {
        useChatStore.getState().updateChatTitle(data.chat_id, data.title);
      }
    } catch {
      /* ignore */
    }
  };

  const finish = (
    status: MessageStatus,
    finalContent?: string,
    error?: string | null
  ) => {
    if (!isCurrent()) return;
    clearTimeout(retryTimer);
    const final = finalContent ?? content;
    useChatStore
      .getState()
      .updateMessageContent(chatId, messageId, final, status, error ?? null);
    try {
      es.close();
    } catch {
      /* ignore */
    }
    useChatStore.setState((s) => {
      const { [chatId]: _, ...rest } = s.generating;
      return { generating: rest };
    });
    useChatStore.getState().loadChats();
    useChatStore.getState().loadUsage();
  };

  const onDone = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      finish(
        (data.status as MessageStatus) || "completed",
        data.content,
        data.error
      );
    } catch {
      finish("completed");
    }
  };

  const onStopped = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      finish("stopped", data.content);
    } catch {
      finish("stopped");
    }
  };

  const onErrorEvent = (e: MessageEvent) => {
    if (e.data) {
      try {
        const data = JSON.parse(e.data);
        finish("failed", data.content ?? content, data.error || data.message || "Generation failed");
        return;
      } catch {
        /* fall through */
      }
    }
  };

  es.addEventListener("thinking", onThinking);
  es.addEventListener("status", onStatus as EventListener);
  es.addEventListener("catchup", onCatchup as EventListener);
  es.addEventListener("token", onToken as EventListener);
  es.addEventListener("title", onTitle as EventListener);
  es.addEventListener("done", onDone as EventListener);
  es.addEventListener("stopped", onStopped as EventListener);
  es.addEventListener("failed", onErrorEvent as EventListener);
  es.addEventListener("error", onErrorEvent as EventListener);

  // EventSource reconnects automatically. Bound the total outage time so the
  // composer cannot stay disabled forever after an authorization/server failure.
  let disconnectedAt: number | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  es.onopen = () => { disconnectedAt = null; clearTimeout(retryTimer); };
  es.onerror = () => {
    if (!isCurrent()) return;
    disconnectedAt ??= Date.now();
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (!isCurrent() || disconnectedAt === null) return;
      if (es.readyState === EventSource.CLOSED || Date.now() - disconnectedAt >= 15000) {
        finish("failed", content, "Connection lost. Reopen this chat to reconnect.");
      }
    }, Math.max(0, 15000 - (Date.now() - disconnectedAt)));
  };
}

