"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, MailCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useChatStore } from "@/lib/store";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthFrame } from "@/components/auth/AuthFrame";

export default function ForgotPasswordPage() {
  const { t, locale } = useChatStore();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err: unknown) {
      setError(friendlyError(err, useChatStore.getState().locale, "pleaseWait"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame>
        <div>
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-500">{locale === "mn" ? "БҮРТГЭЛ СЭРГЭЭХ" : "ACCOUNT RECOVERY"}</p>
          <h1 className="font-display text-[28px] font-medium tracking-[-0.04em]">
            {t("forgotTitle")}
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-neutral-500">
            {t("forgotSubtitle")}
          </p>
        </div>
        {sent ? (
          <div role="status" className="flex items-start gap-3 rounded-xl border border-white/[0.09] bg-white/[0.03] p-4 text-[13px] leading-6 text-neutral-300">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
            <p>{t("forgotSent")}</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label htmlFor="forgot-email" className="text-xs font-medium text-neutral-300">{t("email")}</label>
              <Input
                id="forgot-email"
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
            {error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-xs text-red-300">{error}</p>}
            <Button
              type="submit"
              className="relative h-12 w-full rounded-xl bg-neutral-100 text-[13px] font-semibold text-neutral-950 hover:bg-white"
              disabled={loading}
            >
              {t("forgotSubmit")}
              {loading ? <Loader2 className="absolute right-4 h-4 w-4 animate-spin" /> : <ArrowRight className="absolute right-4 h-4 w-4" />}
            </Button>
          </form>
        )}
        <p className="border-t border-white/[0.07] pt-6 text-center text-xs text-neutral-500">
          <Link href="/login" className="font-medium text-neutral-200 underline-offset-4 hover:underline">
            {t("backToSignIn")}
          </Link>
        </p>
    </AuthFrame>
  );
}
