"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { friendlyError } from "@/lib/errors";
import { useChatStore } from "@/lib/store";
import { usedPercent } from "@/lib/usage";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

export default function ProfilePage() {
  const user = useChatStore(s => s.user);
  const locale = useChatStore(s => s.locale);
  const usage = useChatStore(s => s.usage);
  const loadAuth = useChatStore(s => s.loadAuth);
  const loadUsage = useChatStore(s => s.loadUsage);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const mn = locale === "mn";

  useEffect(() => {
    let active = true;
    (async () => {
      try { await loadAuth(); await loadUsage(); }
      catch { if (active) setError(true); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, [loadAuth, loadUsage]);

  const savedName = user?.full_name ?? "";
  // Fill the field once the account arrives, and again after a save.
  useEffect(() => { setName(savedName); }, [savedName]);

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (savingName || name.trim() === savedName) return;
    setSavingName(true);
    try {
      await useChatStore.getState().updateProfile(name.trim());
      toast.success(mn ? "Нэр хадгалагдлаа" : "Name saved");
    } catch (cause) {
      toast.error(friendlyError(cause, locale));
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (savingPassword) return;
    const problem = next.length < 6 ? (mn ? "Шинэ нууц үг дор хаяж 6 тэмдэгт байна." : "The new password needs at least 6 characters.")
      : utf8Length(next) > 72 ? (mn ? "Шинэ нууц үг хэт урт байна." : "The new password is too long.")
      : next !== confirm ? (mn ? "Шинэ нууц үгүүд таарахгүй байна." : "The new passwords don’t match.")
      : next === current ? (mn ? "Шинэ нууц үг өмнөхөөсөө өөр байх ёстой." : "Choose a password different from the current one.")
      : "";
    setPasswordError(problem);
    if (problem) return;
    setSavingPassword(true);
    try {
      const { access_token } = await api.changePassword(current, next);
      localStorage.setItem("access_token", access_token);
      setCurrent(""); setNext(""); setConfirm("");
      toast.success(mn ? "Нууц үг солигдлоо" : "Password changed");
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      setPasswordError(status === 400 && /current password/i.test(String((cause as Error).message))
        ? (mn ? "Одоогийн нууц үг буруу байна." : "The current password is incorrect.")
        : friendlyError(cause, locale));
    } finally {
      setSavingPassword(false);
    }
  };

  const resend = async () => {
    if (resending) return;
    setResending(true);
    try {
      const { sent } = await api.resendVerification();
      if (sent) setResent(true);
      else await loadAuth(); // confirmed in another tab meanwhile
    } catch (cause) {
      toast.error(friendlyError(cause, locale));
    } finally {
      setResending(false);
    }
  };

  const signedIn = !!user && !user.is_guest;
  const initial = Array.from((user?.full_name?.trim() || user?.email || "?"))[0]?.toLocaleUpperCase(locale);
  const unlimited = !!usage && usage.daily_limit >= 999999;
  // Shown as a percentage only; the message counts are not displayed.
  const usedPct = usage && !unlimited ? usedPercent(usage.used_today, usage.daily_limit) : 0;
  const label = "mb-2 block text-xs font-medium text-neutral-400";

  return (
    <div>
      <main className="mx-auto min-h-screen max-w-2xl px-6 py-10">
        <header className="mb-16 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />{mn ? "Чат руу буцах" : "Back to chat"}
          </Link>
          <LanguageSwitch />
        </header>

        <h1 className="text-4xl font-display tracking-tight">{mn ? "Миний профайл" : "My profile"}</h1>

        {!ready ? (
          <p className="mt-10 flex items-center gap-2 text-sm text-neutral-400" role="status">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{mn ? "Уншиж байна…" : "Loading…"}
          </p>
        ) : !signedIn ? (
          <div className="rounded-2xl border border-white/10 mt-10 p-7">
            <p className="text-sm text-neutral-400">{mn ? "Профайлаа харахын тулд нэвтэрнэ үү." : "Sign in to view your profile."}</p>
            <Link className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-45 mt-6" href="/login">{mn ? "Нэвтрэх" : "Sign in"}</Link>
          </div>
        ) : (
          <div className="mt-10 space-y-5">
            {error && <p role="alert" className="text-sm text-red-300">{mn ? "Зарим мэдээллийг уншиж чадсангүй." : "Some account details could not be loaded."}</p>}

            <section className="rounded-2xl border border-white/10 flex items-center gap-4 p-6">
              <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-white/15 bg-neutral-900 font-display text-xl font-medium text-neutral-200">{initial}</span>
              <div className="min-w-0">
                <p className="truncate text-lg font-medium">{user.full_name?.trim() || (mn ? "Нэргүй" : "No name yet")}</p>
                <p className="truncate text-sm text-neutral-400">{user.email}</p>
              </div>
              <span className="ml-auto shrink-0 rounded-full border border-white/15 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.1em] text-neutral-300">
                {user.role === "admin" ? "Admin" : usage?.subscription_tier || "free"}
              </span>
            </section>

            {user.email_verified === false && (
              <section className="rounded-2xl border border-white/10 p-6" aria-labelledby="verify-title">
                <h2 id="verify-title" className="text-sm font-medium">{mn ? "И-мэйлээ баталгаажуулна уу" : "Confirm your email"}</h2>
                <p className="mt-1 text-xs text-neutral-500" role={resent ? "status" : undefined}>
                  {resent
                    ? (mn ? "Баталгаажуулах холбоос илгээлээ. И-мэйлээ шалгана уу." : "A confirmation link is on its way. Check your inbox.")
                    : (mn ? "Нууц үгээ мартсан үед сэргээх боломжтой байхын тулд хаягаа баталгаажуулаарай." : "Confirming your address makes sure you can recover the account if you forget your password.")}
                </p>
                {!resent && (
                  <button type="button" onClick={resend} disabled={resending}
                    className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-xs text-neutral-200 hover:bg-white/[0.06] disabled:opacity-45">
                    {resending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                    {mn ? "Холбоос илгээх" : "Send confirmation link"}
                  </button>
                )}
              </section>
            )}

            <section className="rounded-2xl border border-white/10 p-6" aria-labelledby="usage-title">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="usage-title" className="text-sm font-medium">{mn ? "Өнөөдрийн хэрэглээ" : "Today’s usage"}</h2>
                <p className="text-sm tabular-nums text-neutral-400">
                  {!usage ? "—" : unlimited ? (mn ? "Хязгааргүй" : "Unlimited") : `${usedPct}%`}
                </p>
              </div>
              {usage && !unlimited && (
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-800" role="progressbar"
                  aria-labelledby="usage-title" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPct}>
                  <div className="h-full rounded-full bg-neutral-300" style={{ width: `${usedPct}%` }} />
                </div>
              )}
              <Link href="/pricing" className="inline-flex items-center justify-center rounded-xl border border-white/15 px-4 text-neutral-200 hover:bg-white/[0.06] mt-5 h-9 text-xs">{mn ? "Багц ба төлбөр" : "Plans & billing"}</Link>
            </section>

            <form className="rounded-2xl border border-white/10 p-6" onSubmit={saveName} aria-labelledby="name-title">
              <h2 id="name-title" className="text-sm font-medium">{mn ? "Харагдах нэр" : "Display name"}</h2>
              <p className="mt-1 text-xs text-neutral-500">{mn ? "Цэс болон профайл дээр харагдана." : "Shown in the menu and on your profile."}</p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input className="h-11 w-full rounded-xl border border-white/15 bg-neutral-950 px-3.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus-visible:border-neutral-400 disabled:opacity-60" aria-labelledby="name-title" value={name} maxLength={255} autoComplete="name"
                  onChange={e => setName(e.target.value)} disabled={savingName} placeholder={mn ? "Таны нэр" : "Your name"} />
                <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-45 shrink-0" disabled={savingName || name.trim() === savedName}>
                  {savingName ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                  {mn ? "Хадгалах" : "Save"}
                </button>
              </div>
            </form>

            <form className="rounded-2xl border border-white/10 p-6" onSubmit={savePassword} aria-labelledby="password-title">
              <h2 id="password-title" className="text-sm font-medium">{mn ? "Нууц үг солих" : "Change password"}</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="current-password" className={label}>{mn ? "Одоогийн нууц үг" : "Current password"}</label>
                  <input id="current-password" type="password" className="h-11 w-full rounded-xl border border-white/15 bg-neutral-950 px-3.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus-visible:border-neutral-400 disabled:opacity-60" autoComplete="current-password" required
                    value={current} onChange={e => setCurrent(e.target.value)} disabled={savingPassword} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="new-password" className={label}>{mn ? "Шинэ нууц үг" : "New password"}</label>
                    <input id="new-password" type="password" className="h-11 w-full rounded-xl border border-white/15 bg-neutral-950 px-3.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus-visible:border-neutral-400 disabled:opacity-60" autoComplete="new-password" required minLength={6}
                      value={next} onChange={e => setNext(e.target.value)} disabled={savingPassword} />
                  </div>
                  <div>
                    <label htmlFor="confirm-password" className={label}>{mn ? "Шинэ нууц үгээ давтах" : "Repeat new password"}</label>
                    <input id="confirm-password" type="password" className="h-11 w-full rounded-xl border border-white/15 bg-neutral-950 px-3.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus-visible:border-neutral-400 disabled:opacity-60" autoComplete="new-password" required
                      value={confirm} onChange={e => setConfirm(e.target.value)} disabled={savingPassword} />
                  </div>
                </div>
                {passwordError && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-red-300">{passwordError}</p>}
                <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-45" disabled={savingPassword || !current || !next || !confirm}>
                  {savingPassword && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {mn ? "Нууц үг солих" : "Update password"}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
