const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

function getHeaders(json = true): HeadersInit {
  const headers: HeadersInit = {};
  if (json) headers["Content-Type"] = "application/json";
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const guestId = localStorage.getItem("guest_id");
    if (guestId) headers["X-Guest-Id"] = guestId;
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = await res.json();
      detail =
        typeof err.detail === "string"
          ? err.detail
          : JSON.stringify(err.detail || err);
    } catch {
      /* ignore */
    }
    // Session expired / unauthorized
    if (res.status === 401 && typeof window !== "undefined") {
      const hadToken = !!localStorage.getItem("access_token");
      if (hadToken) {
        localStorage.removeItem("access_token");
        // Notify other tabs
        localStorage.setItem("auth_logout", String(Date.now()));
      }
    }
    const error = new Error(detail || "Request failed") as Error & {
      status?: number;
    };
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  async createGuest() {
    const res = await fetch(`${API_URL}/api/v1/auth/guest`, {
      method: "POST",
      headers: getHeaders(),
    });
    return handleResponse<{ guest_id: string; access_token?: string }>(res);
  },

  async login(email: string, password: string) {
    const res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ email, password }),
    });
    return handleResponse<{ access_token: string }>(res);
  },

  async register(email: string, password: string, full_name?: string) {
    const res = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ email, password, full_name }),
    });
    return handleResponse<{ access_token: string }>(res);
  },

  async me() {
    const res = await fetch(`${API_URL}/api/v1/auth/me`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async listChats(q?: string) {
    const url = q
      ? `${API_URL}/api/v1/chats?q=${encodeURIComponent(q)}`
      : `${API_URL}/api/v1/chats`;
    const res = await fetch(url, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getChat(chatId: string) {
    const res = await fetch(`${API_URL}/api/v1/chats/${chatId}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async createChat() {
    const res = await fetch(`${API_URL}/api/v1/chats`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ title: "New Chat" }),
    });
    return handleResponse(res);
  },

  async deleteChat(chatId: string) {
    const res = await fetch(`${API_URL}/api/v1/chats/${chatId}`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async renameChat(chatId: string, title: string) {
    const res = await fetch(`${API_URL}/api/v1/chats/${chatId}`, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ title }),
    });
    return handleResponse(res);
  },

  async deleteDocument(docId: string) {
    const res = await fetch(`${API_URL}/api/v1/documents/${docId}`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async sendMessage(content: string, chatId?: string, persona?: string) {
    const res = await fetch(`${API_URL}/api/v1/chats/send`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        content,
        chat_id: chatId || null,
        persona: persona && persona !== "default" ? persona : null,
      }),
    });
    return handleResponse(res);
  },

  async getPlans() {
    const res = await fetch(`${API_URL}/api/v1/payments/plans`);
    return handleResponse(res);
  },

  async getSubscription() {
    const res = await fetch(`${API_URL}/api/v1/payments/subscription/me`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async createCheckout(plan: "pro" | "premium") {
    const res = await fetch(`${API_URL}/api/v1/payments/checkout`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ plan }),
    });
    return handleResponse<{ checkout_url: string }>(res);
  },

  async demoUpgrade(plan: "pro" | "premium") {
    const res = await fetch(`${API_URL}/api/v1/payments/demo-upgrade`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ plan }),
    });
    return handleResponse(res);
  },

  async stopGeneration(chatId: string, messageId: string) {
    const res = await fetch(
      `${API_URL}/api/v1/chats/${chatId}/messages/${messageId}/stop`,
      { method: "POST", headers: getHeaders() }
    );
    return handleResponse(res);
  },

  async regenerate(chatId: string, messageId: string) {
    const res = await fetch(
      `${API_URL}/api/v1/chats/${chatId}/messages/${messageId}/regenerate`,
      { method: "POST", headers: getHeaders() }
    );
    return handleResponse(res);
  },

  async getUsage() {
    const res = await fetch(`${API_URL}/api/v1/chats/usage/me`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async uploadDocument(file: File) {
    const form = new FormData();
    form.append("file", file);
    const headers: HeadersInit = {};
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("access_token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const guestId = localStorage.getItem("guest_id");
      if (guestId) headers["X-Guest-Id"] = guestId;
    }
    const res = await fetch(`${API_URL}/api/v1/documents/upload`, {
      method: "POST",
      headers,
      body: form,
    });
    return handleResponse(res);
  },

  async listDocuments() {
    const res = await fetch(`${API_URL}/api/v1/documents`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  streamUrl(generationId: string) {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    const guestId =
      typeof window !== "undefined" ? localStorage.getItem("guest_id") : null;
    const params = new URLSearchParams();
    if (token) params.set("token", token);
    if (guestId) params.set("guest_id", guestId);
    const qs = params.toString();
    return `${API_URL}/api/v1/stream/${generationId}${qs ? `?${qs}` : ""}`;
  },
};
