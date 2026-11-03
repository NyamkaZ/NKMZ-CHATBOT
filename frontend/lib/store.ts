import { create } from "zustand";
import { api } from "./api";
import type { Locale, TranslationKey } from "./i18n";
import { translate } from "./i18n";

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
  messagesByChat: Record<string, Message[]>;
  generating: Record<string, GeneratingState>;
  usage: Usage | null;
  user: AuthUser | null;
  authLoaded: boolean;
  isLoadingChats: boolean;
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
  logout: () => void;
  loadChats: () => Promise<void>;
  selectChat: (chatId: string | null) => Promise<void>;
  createNewChat: () => void;
  deleteChat: (chatId: string) => Promise<void>;
  renameChat: (chatId: string, title: string) => Promise<void>;
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
  messagesByChat: {},
  generating: {},
  usage: null,
  user: null,
  authLoaded: false,
  isLoadingChats: false,
  isSending: false,
  searchQuery: "",
  sidebarOpen: true,
  theme: "dark",
  locale: "mn",
  persona: "default",

  setPersona: (p) => {
    set({ persona: p });
    if (typeof window !== "undefined") localStorage.setItem("persona", p);
  },

  setTheme: (t) => {
    set({ theme: t });
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", t === "dark");
      localStorage.setItem("theme", t);
    }
  },

  setLocale: (l) => {
    set({ locale: l });
    if (typeof window !== "undefined") localStorage.setItem("locale", l);
  },

  t: (key) => translate(get().locale, key),

  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  loadAuth: async () => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("access_token");
    if (!token) {
      set({ user: null, authLoaded: true });
      return;
    }
    try {
      const me = (await api.me()) as AuthUser;
      set({ user: me, authLoaded: true });
    } catch {
      // Invalid/expired token — clear and allow guest flow
      localStorage.removeItem("access_token");
      set({ user: null, authLoaded: true });
    }
  },

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      localStorage.removeItem("guest_id");
      localStorage.setItem("auth_logout", String(Date.now()));
    }
    set({
      user: null,
      chats: [],
      currentChatId: null,
      messagesByChat: {},
      usage: null,
      authLoaded: true,
    });
    get()
      .ensureGuest()
      .then(() => {
        get().loadAuth();
        get().loadChats();
        get().loadUsage();
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
    try {
      const data = await api.createGuest();
      localStorage.setItem("guest_id", data.guest_id);
      if (data.access_token) localStorage.setItem("access_token", data.access_token);
    } catch (e) {
      console.error("Guest session failed", e);
    }
  },

  loadChats: async () => {
    set({ isLoadingChats: true });
    try {
      await get().ensureGuest();
      const list = (await api.listChats(get().searchQuery || undefined)) as Chat[];
      set({ chats: list });
    } catch (e) {
      console.error(e);
    } finally {
      set({ isLoadingChats: false });
    }
  },

  selectChat: async (chatId) => {
    set({ currentChatId: chatId });
    if (!chatId) return;

    const existing = get().messagesByChat[chatId];
    const gen = get().generating[chatId];

    // Re-attach live stream if generation still running
    if (
      gen &&
      gen.status !== "completed" &&
      gen.status !== "stopped" &&
      gen.status !== "failed"
    ) {
      if (!gen.eventSource || gen.eventSource.readyState === EventSource.CLOSED) {
        attachStream(chatId, gen.generationId, gen.messageId, gen.content);
      }
      if (existing && existing.length > 0) return;
    }

    if (existing && existing.length > 0 && !gen) {
      // Still refresh in background in case message finished while away
      api
        .getChat(chatId)
        .then((chat: any) => {
          set((s) => ({
            messagesByChat: {
              ...s.messagesByChat,
              [chatId]: chat.messages || [],
            },
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    title: chat.title,
                    is_title_generated: chat.is_title_generated,
                    updated_at: chat.updated_at,
                  }
                : c
            ),
          }));
          const last = [...(chat.messages || [])]
            .reverse()
            .find((m: Message) => m.role === "assistant");
          if (
            last?.generation_id &&
            (last.status === "thinking" || last.status === "streaming")
          ) {
            attachStream(chatId, last.generation_id, last.id, last.content || "");
          }
        })
        .catch(console.error);
      return;
    }

    try {
      const chat = (await api.getChat(chatId)) as Chat & { messages: Message[] };
      set((s) => ({
        messagesByChat: { ...s.messagesByChat, [chatId]: chat.messages || [] },
        chats: s.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                title: chat.title,
                is_title_generated: chat.is_title_generated,
                updated_at: chat.updated_at,
              }
            : c
        ),
      }));

      const last = [...(chat.messages || [])]
        .reverse()
        .find((m) => m.role === "assistant");
      if (
        last?.generation_id &&
        (last.status === "thinking" || last.status === "streaming")
      ) {
        attachStream(chatId, last.generation_id, last.id, last.content || "");
      }
    } catch (e) {
      console.error(e);
    }
  },

  createNewChat: () => {
    set({ currentChatId: null });
  },

  deleteChat: async (chatId: string) => {
    try {
      const gen = get().generating[chatId];
      if (gen) {
        gen.eventSource?.close();
        try {
          await api.stopGeneration(chatId, gen.messageId);
        } catch {
          /* ignore */
        }
      }
      await api.deleteChat(chatId);
      set((s) => {
        const { [chatId]: _m, ...messagesByChat } = s.messagesByChat;
        const { [chatId]: _g, ...generating } = s.generating;
        return {
          chats: s.chats.filter((c) => c.id !== chatId),
          messagesByChat,
          generating,
          currentChatId: s.currentChatId === chatId ? null : s.currentChatId,
        };
      });
    } catch (e) {
      console.error(e);
      throw e;
    }
  },

  renameChat: async (chatId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await api.renameChat(chatId, trimmed);
    get().updateChatTitle(chatId, trimmed);
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
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, title, is_title_generated: true } : c
      ),
    }));
  },

  sendMessage: async (content: string) => {
    const { currentChatId, generating } = get();
    if (currentChatId && generating[currentChatId]) {
      const g = generating[currentChatId];
      if (g.status === "thinking" || g.status === "streaming") {
        try { g.eventSource?.close(); } catch {}
        set((s) => {
          const { [currentChatId]: _, ...rest } = s.generating;
          return { generating: rest };
        });
      }
    }

    set({ isSending: true });
    try {
      await get().ensureGuest();
      const persona = get().persona;
      const data: any = await api.sendMessage(
        content,
        currentChatId || undefined,
        persona
      );
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
        return {
          currentChatId: chat.id,
          messagesByChat: { ...s.messagesByChat, [chat.id]: msgs },
          chats,
          usage: usage || s.usage,
        };
      });

      if (asstMsg.generation_id) {
        attachStream(chat.id, asstMsg.generation_id, asstMsg.id, "");
      }
    } finally {
      set({ isSending: false });
    }
  },

  stopGenerating: async (chatId: string) => {
    const gen = get().generating[chatId];
    if (!gen) return;
    try {
      await api.stopGeneration(chatId, gen.messageId);
      get().updateMessageContent(chatId, gen.messageId, gen.content, "stopped");
      gen.eventSource?.close();
      set((s) => {
        const { [chatId]: _, ...rest } = s.generating;
        return { generating: rest };
      });
    } catch (e) {
      console.error(e);
    }
  },

  regenerate: async (chatId: string, messageId: string) => {
    if (get().generating[chatId]) return;
    set({ isSending: true });
    try {
      const data: any = await api.regenerate(chatId, messageId);
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
      set({ isSending: false });
    }
  },

  loadUsage: async () => {
    try {
      const u = (await api.getUsage()) as Usage;
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
  let content = initialContent || prev?.content || "";

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
    setGen({ status: "thinking" });
    useChatStore
      .getState()
      .updateMessageContent(chatId, messageId, content, "thinking");
  };

  const onStatus = (e: MessageEvent) => {
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
    try {
      const data = JSON.parse(e.data);
      content = data.content || content;
      const st = (data.status as MessageStatus) || "streaming";
      setGen({ content, status: st });
      useChatStore.getState().updateMessageContent(chatId, messageId, content, st);
    } catch {
      /* ignore */
    }
  };

  const onToken = (e: MessageEvent) => {
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
        finish("failed", content, data.message || "Generation failed");
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

  // Network blip: try reconnect a few times while generation may still run
  let reconnectAttempts = 0;
  const maxReconnect = 5;
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      const still = useChatStore.getState().generating[chatId];
      if (
        still &&
        still.generationId === generationId &&
        (still.status === "thinking" || still.status === "streaming") &&
        reconnectAttempts < maxReconnect
      ) {
        reconnectAttempts += 1;
        const delay = Math.min(1000 * reconnectAttempts, 5000);
        setTimeout(() => {
          const cur = useChatStore.getState().generating[chatId];
          if (
            cur &&
            cur.generationId === generationId &&
            (cur.status === "thinking" || cur.status === "streaming")
          ) {
            attachStream(chatId, generationId, messageId, content);
          }
        }, delay);
      }
    }
  };
}
