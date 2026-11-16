"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useChatStore } from "@/lib/store";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthFrame } from "@/components/auth/AuthFrame";

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const { t, locale } = useChatStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(!token);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = password.length < 6 ? t("passwordTooShort")
      : utf8Length(password) > 72 ? t("passwordTooLong")
      : password !== confirm ? t("passwordMismatch")
      : "";
    setError(problem);
    if (problem) return;
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      toast.success(t("resetDone"));
      router.replace("/login");
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 400) setExpired(true);
      else setError(friendlyError(err, useChatStore.getState().locale, "pleaseWait"));
    } finally {
      setLoading(false);
    }
  };

  const field = "h-12 rounded-xl text-[13px] placeholder:text-neutral-600 focus-visible:ring-1";

  return (
    <AuthFrame>
        <div>
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-500">{locale === "mn" ? "БҮРТГЭЛ СЭРГЭЭХ" : "ACCOUNT RECOVERY"}</p>
          <h1 className="font-display text-[28px] font-medium tracking-[-0.04em]">
            {t("resetTitle")}
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-neutral-500">
            {expired ? t("resetExpired") : t("resetSubtitle")}
          </p>
        </div>
        {expired ? (
          <Link
            href="/forgot-password"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] text-xs text-neutral-400 transition-colors hover:border-white/20 hover:bg-white/[0.03] hover:text-neutral-100 focus-visible:outline focus-visible:outline-offset-4 focus-visible:outline-neutral-400"
          >
            {t("resetRequestNew")}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label htmlFor="reset-password" className="text-xs font-medium text-neutral-300">{t("newPassword")}</label>
              <div className="relative mt-2">
                <Input
                  id="reset-password"
                  name="new-password"
                  autoComplete="new-password"
                  type={show ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className={`${field} pr-11`}
                />
                <button type="button" onClick={() => setShow(!show)}
                  aria-label={locale === "mn" ? (show ? "Нууц үгийг нуух" : "Нууц үгийг харах") : (show ? "Hide password" : "Show password")}
                  className="absolute inset-y-0 right-3 flex items-center text-neutral-500 transition-colors hover:text-neutral-200">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="reset-confirm" className="text-xs font-medium text-neutral-300">{t("repeatPassword")}</label>
              <Input
                id="reset-confirm"
                name="confirm-password"
                autoComplete="new-password"
                type={show ? "text" : "password"}
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                disabled={loading}
                className={`mt-2 ${field}`}
              />
            </div>
            {error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-xs text-red-300">{error}</p>}
            <Button
              type="submit"
              className="relative h-12 w-full rounded-xl bg-neutral-100 text-[13px] font-semibold text-neutral-950 hover:bg-white"
              disabled={loading}
            >
              {t("resetSubmit")}
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

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary for the production build.
  return <Suspense fallback={null}><ResetPasswordForm /></Suspense>;
}
