"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useChatStore } from "@/lib/store";
import { AuthFrame } from "@/components/auth/AuthFrame";

type State = "checking" | "confirmed" | "invalid" | "failed";

function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const { t, locale } = useChatStore();
  const [state, setState] = useState<State>(token ? "checking" : "invalid");
  const started = useRef(false);

  useEffect(() => {
    // The link works once: never send it twice (React runs effects twice in development).
    if (!token || started.current) return;
    started.current = true;
    api.verifyEmail(token)
      .then(() => {
        setState("confirmed");
        void useChatStore.getState().loadAuth();
      })
      .catch((error: { status?: number }) => setState(error.status === 400 ? "invalid" : "failed"));
  }, [token]);

  const message = state === "checking" ? t("verifyChecking")
    : state === "confirmed" ? t("verifyDone")
    : state === "invalid" ? t("verifyInvalid")
    : t("networkBusy");

  return (
    <AuthFrame>
        <div>
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-500">{locale === "mn" ? "И-МЭЙЛ БАТАЛГААЖУУЛАЛТ" : "EMAIL CONFIRMATION"}</p>
          <h1 className="font-display text-[28px] font-medium tracking-[-0.04em]">
            {t("verifyTitle")}
          </h1>
          <p role="status" className="mt-2 flex items-center gap-2 text-[13px] leading-6 text-neutral-500">
            {state === "checking" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {message}
          </p>
        </div>
        {state !== "checking" && (
          <Link
            href={state === "confirmed" ? "/" : "/profile"}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] text-xs text-neutral-400 transition-colors hover:border-white/20 hover:bg-white/[0.03] hover:text-neutral-100 focus-visible:outline focus-visible:outline-offset-4 focus-visible:outline-neutral-400"
          >
            {state === "confirmed" ? t("backToChat") : t("verifyResendFromProfile")}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
    </AuthFrame>
  );
}

export default function VerifyEmailPage() {
  return <Suspense fallback={null}><VerifyEmail /></Suspense>;
}
