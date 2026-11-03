"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useChatStore } from "@/lib/store";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";

export default function RegisterPage() {
  const router = useRouter();
  const { t, locale, setLocale, loadAuth, user, authLoaded } = useChatStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("locale") as Locale | null;
    if (saved === "en" || saved === "mn") setLocale(saved);
    loadAuth();
  }, []);

  useEffect(() => {
    if (authLoaded && user && !user.is_guest) {
      router.replace("/");
    }
  }, [authLoaded, user, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api.register(email, password, fullName || undefined);
      localStorage.setItem("access_token", data.access_token);
      localStorage.removeItem("guest_id");
      await loadAuth();
      router.replace("/");
    } catch (err: unknown) {
      setError(
        friendlyError(err, useChatStore.getState().locale, "registerFailed")
      );
    } finally {
      setLoading(false);
    }
  };

  if (authLoaded && user && !user.is_guest) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        …
      </div>
    );
  }

  return (
    <div className="chat-atmosphere flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-border/70 bg-background/70 p-8 shadow-glow backdrop-blur-xl">
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-teal-700 text-primary-foreground font-display text-xs font-bold">
              NK
            </div>
            <span className="font-display text-sm font-semibold">NKMZ Chat</span>
          </div>
          <div className="flex gap-1 rounded-xl bg-muted/50 p-0.5">
            <Button
              variant={locale === "mn" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 text-xs rounded-lg"
              onClick={() => setLocale("mn")}
            >
              Монгол
            </Button>
            <Button
              variant={locale === "en" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 text-xs rounded-lg"
              onClick={() => setLocale("en")}
            >
              English
            </Button>
          </div>
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {t("createAccount")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("startChatting")}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">{t("fullName")}</label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1.5 h-11 rounded-xl"
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("email")}</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1.5 h-11 rounded-xl"
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("password")}</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="mt-1.5 h-11 rounded-xl"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            className="w-full h-11 rounded-xl"
            disabled={loading}
          >
            {loading ? t("creating") : t("createAccount")}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          {t("haveAccount")}{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">
            {t("signIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}
