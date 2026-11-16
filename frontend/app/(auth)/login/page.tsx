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
import { ArrowRight, ArrowUpRight, Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { t, locale, loadAuth, user, authLoaded } = useChatStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      const data = await api.login(email, password);
      localStorage.setItem("access_token", data.access_token);
      localStorage.removeItem("guest_id");
      await loadAuth();
      router.replace("/");
    } catch (err: unknown) {
      setError(
        friendlyError(err, useChatStore.getState().locale, "loginFailed")
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
    <AuthFrame decryptHeading>
        <div>
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-500">{locale === "mn" ? "ТАНЫ ОРОН ЗАЙ" : "YOUR PERSONAL SPACE"}</p>
          <h1 className="font-display text-[28px] font-medium tracking-[-0.04em]">
            {t("welcomeBack")}
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-neutral-500">
            {t("signInContinue")}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label htmlFor="login-email" className="text-xs font-medium text-neutral-300">{t("email")}</label>
            <Input
              id="login-email"
              name="email"
              autoComplete="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="mt-2 h-12 rounded-xl text-[13px] placeholder:text-neutral-600 focus-visible:ring-1"
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="login-password" className="text-xs font-medium text-neutral-300">{t("password")}</label>
              <Link href="/forgot-password" className="text-xs text-neutral-500 underline-offset-4 hover:text-neutral-200 hover:underline">
                {t("forgotLink")}
              </Link>
            </div>
            <div className="relative mt-2">
            <Input
              id="login-password"
              name="password"
              autoComplete="current-password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              className="h-12 rounded-xl pr-11 text-[13px] placeholder:text-neutral-600 focus-visible:ring-1"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              aria-label={locale === "mn" ? (showPassword ? "Нууц үгийг нуух" : "Нууц үгийг харах") : (showPassword ? "Hide password" : "Show password")}
              className="absolute inset-y-0 right-3 flex items-center text-neutral-500 transition-colors hover:text-neutral-200">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            </div>
          </div>
          {error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-xs text-red-300">{error}</p>}
          <LiquidMetalButton type="submit" fullWidth size={48} disabled={loading}>
            {loading ? t("signingIn") : t("signIn")}
            {loading ? <Loader2 className="absolute right-4 h-4 w-4 animate-spin" /> : <ArrowRight className="absolute right-4 h-4 w-4" />}
          </LiquidMetalButton>
          <Link
            href="/about"
            prefetch={false}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] text-xs text-neutral-400 transition-colors hover:border-white/20 hover:bg-white/[0.03] hover:text-neutral-100 focus-visible:outline focus-visible:outline-offset-4 focus-visible:outline-neutral-400"
          >
            {locale === "mn" ? "Бидний тухай" : "About NKMZ"}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </form>
        <p className="border-t border-white/[0.07] pt-6 text-center text-xs text-neutral-500">
          {t("noAccount")}{" "}
          <Link href="/register" className="ml-1 font-medium text-neutral-200 underline-offset-4 hover:underline">
            {t("register")}
          </Link>
        </p>
        <p className="text-center text-[10px] tracking-wide text-neutral-600">
          Created by <span className="text-neutral-400">Nyamtsogt</span>
        </p>
    </AuthFrame>
  );
}

