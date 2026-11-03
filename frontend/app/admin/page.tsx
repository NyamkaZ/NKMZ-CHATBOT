"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useChatStore } from "@/lib/store";
import { api } from "@/lib/api";
import { FileUp, Loader2, Trash2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function headers() {
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) h["Authorization"] = `Bearer ${token}`;
  }
  return h;
}

export default function AdminPage() {
  const router = useRouter();
  const { user, authLoaded, loadAuth, t } = useChatStore();
  const [status, setStatus] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [limitInput, setLimitInput] = useState("30");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAuth();
  }, []);

  useEffect(() => {
    if (!authLoaded) return;
    if (!user || user.is_guest || user.role !== "admin") {
      setError(t("adminRequired"));
      const timer = setTimeout(() => router.replace("/login"), 1500);
      return () => clearTimeout(timer);
    }
    load();
  }, [authLoaded, user]);

  const load = async () => {
    try {
      const opts = { headers: headers() };
      const [s, a, u, m, st, d] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/status`, opts).then(async (r) => {
          if (!r.ok) throw new Error(t("adminRequired"));
          return r.json();
        }),
        fetch(`${API_URL}/api/v1/admin/analytics`, opts).then((r) => r.json()),
        fetch(
          `${API_URL}/api/v1/admin/users?q=${encodeURIComponent(search)}`,
          opts
        ).then((r) => r.json()),
        fetch(`${API_URL}/api/v1/admin/models`, opts).then((r) => r.json()),
        fetch(`${API_URL}/api/v1/admin/settings`, opts).then((r) => r.json()),
        api.listDocuments().catch(() => []),
      ]);
      setStatus(s);
      setAnalytics(a);
      setUsers(u);
      setModels(m);
      setSettings(st);
      setDocs(d as any[]);
      setLimitInput(String(st.daily_message_limit ?? 30));
      setError("");
    } catch (e: any) {
      setError(e.message || "Failed to load");
    }
  };

  const saveLimit = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/usage-limit`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ daily_message_limit: Number(limitInput) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to update");
      }
      const data = await res.json();
      toast.success(`Limit → ${data.daily_message_limit}`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleUser = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/v1/admin/users/${id}/toggle-active`, {
        method: "POST",
        headers: headers(),
      });
      await load();
      toast.success("OK");
    } catch {
      toast.error("Failed");
    }
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      await api.uploadDocument(file);
      toast.success(file.name);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDeleteDoc = async (id: string) => {
    if (!confirm("Delete document?")) return;
    try {
      await api.deleteDocument(id);
      toast.success("Deleted");
      await load();
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    }
  };

  if (!authLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> …
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background p-4 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6 md:space-y-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{t("adminPanel")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("adminSubtitle")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load}>
              {t("refresh")}
            </Button>
            <Button variant="outline" onClick={() => router.push("/")}>
              {t("backToChat")}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm">
            {error}
          </div>
        )}

        {status && (
          <section className="rounded-xl border border-border p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-4">{t("systemStatus")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {(
                [
                  [t("overall"), status.status],
                  ["PostgreSQL", status.postgres],
                  ["Redis", status.redis],
                  ["Ollama", status.ollama],
                ] as const
              ).map(([label, val]) => (
                <div key={label}>
                  <div className="text-muted-foreground">{label}</div>
                  <div
                    className={`font-medium capitalize ${
                      String(val).startsWith("ok")
                        ? "text-emerald-500"
                        : "text-destructive"
                    }`}
                  >
                    {val}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Model: {status.ollama_model}
            </p>
          </section>
        )}

        {models.length > 0 && (
          <section className="rounded-xl border border-border p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-4">{t("ollamaModels")}</h2>
            <div className="space-y-2">
              {models.map((m) => (
                <div
                  key={m.name}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="font-mono text-xs md:text-sm break-all">{m.name}</span>
                  <span className={m.available ? "text-emerald-500" : "text-destructive"}>
                    {m.available ? t("available") : t("missing")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {settings && (
          <section className="rounded-xl border border-border p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-4">{t("usageLimits")}</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-muted-foreground">
                  {t("dailyMessages")}
                </label>
                <Input
                  type="number"
                  min={1}
                  className="w-32 mt-1"
                  value={limitInput}
                  onChange={(e) => setLimitInput(e.target.value)}
                />
              </div>
              <Button onClick={saveLimit} disabled={saving}>
                {saving ? t("saving") : t("saveLimit")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Now: {settings.daily_message_limit} · Rate:{" "}
              {settings.rate_limit_per_minute}/min · Guest:{" "}
              {settings.guest_message_limit}
            </p>
          </section>
        )}

        {/* RAG documents */}
        <section className="rounded-xl border border-border p-4 md:p-6">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <h2 className="text-lg font-semibold">{t("knowledgeBase")}</h2>
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <FileUp className="h-4 w-4 mr-1" />
                )}
                {uploading ? t("uploading") : t("clickToUpload")}
              </Button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".txt,.md,.csv,.json,.pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                }}
              />
            </div>
          </div>
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDocuments")}</p>
          ) : (
            <div className="space-y-2">
              {docs.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.original_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {(d.file_size / 1024).toFixed(1)} KB · {d.chunk_count} chunks ·{" "}
                      {d.is_indexed ? t("indexed") : t("pending")}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    onClick={() => onDeleteDoc(d.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {analytics && (
          <section className="rounded-xl border border-border p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-4">{t("analytics")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {[
                [t("users"), analytics.total_users],
                ["Active today", analytics.active_users_today],
                [t("chats"), analytics.total_chats],
                ["Messages", analytics.total_messages],
                ["Msgs today", analytics.messages_today],
                ["Guest → user", analytics.guest_conversions],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <div className="text-muted-foreground">{label}</div>
                  <div className="text-2xl font-bold">{val}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-border p-4 md:p-6">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">{t("users")}</h2>
            <div className="flex gap-2">
              <Input
                placeholder={t("search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-40 md:w-48"
              />
              <Button onClick={load} size="sm">
                {t("search")}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-4">{t("email")}</th>
                  <th className="pb-2 pr-4">{t("role")}</th>
                  <th className="pb-2 pr-4">{t("chats")}</th>
                  <th className="pb-2 pr-4">{t("msgs")}</th>
                  <th className="pb-2 pr-4">{t("active")}</th>
                  <th className="pb-2">{t("action")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border/50">
                    <td className="py-2 pr-4">{u.email || "—"}</td>
                    <td className="py-2 pr-4">{u.role}</td>
                    <td className="py-2 pr-4">{u.chat_count}</td>
                    <td className="py-2 pr-4">{u.daily_message_count}</td>
                    <td className="py-2 pr-4">{u.is_active ? t("yes") : t("no")}</td>
                    <td className="py-2">
                      <Button size="sm" variant="outline" onClick={() => toggleUser(u.id)}>
                        {t("toggle")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
