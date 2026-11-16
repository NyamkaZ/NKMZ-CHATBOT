"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useChatStore } from "@/lib/store";
import { friendlyError } from "@/lib/errors";
import { Input } from "@/components/ui/input";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";
import Link from "next/link";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { ArrowRight, Loader2 } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const { t, locale, loadAuth, user, authLoaded } = useChatStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

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
    <AuthFrame>
        <div>
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-500">{locale === "mn" ? "ШИНЭ ЭХЛЭЛ" : "A NEW BEGINNING"}</p>
          <h1 className="font-display text-[28px] font-medium tracking-[-0.04em]">
            {t("createAccount")}
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-neutral-500">
            {t("startChatting")}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="register-name" className="text-xs font-medium text-neutral-300">{t("fullName")}</label>
            <Input
              id="register-name"
              name="name"
              autoComplete="name"
              maxLength={255}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={loading}
              className="mt-2 h-12 rounded-xl text-[13px] focus-visible:ring-1"
            />
          </div>
          <div>
            <label htmlFor="register-email" className="text-xs font-medium text-neutral-300">{t("email")}</label>
            <Input
              id="register-email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="mt-2 h-12 rounded-xl text-[13px] placeholder:text-neutral-600 focus-visible:ring-1"
            />
          </div>
          <div>
            <label htmlFor="register-password" className="text-xs font-medium text-neutral-300">{t("password")}</label>
            <Input
              id="register-password"
              name="password"
              autoComplete="new-password"
              placeholder="••••••••"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              disabled={loading}
              className="mt-2 h-12 rounded-xl text-[13px] placeholder:text-neutral-600 focus-visible:ring-1"
            />
          </div>
          {error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-xs text-red-300">{error}</p>}
          <LiquidMetalButton type="submit" fullWidth size={48} disabled={loading}>
            {loading ? t("creating") : t("createAccount")}
            {loading ? <Loader2 className="absolute right-4 h-4 w-4 animate-spin" /> : <ArrowRight className="absolute right-4 h-4 w-4" />}
          </LiquidMetalButton>
        </form>
        <p className="border-t border-white/[0.07] pt-6 text-center text-xs text-neutral-500">
          {t("haveAccount")}{" "}
          <Link href="/login" className="ml-1 font-medium text-neutral-200 underline-offset-4 hover:underline">
            {t("signIn")}
          </Link>
        </p>
    </AuthFrame>
  );
}
