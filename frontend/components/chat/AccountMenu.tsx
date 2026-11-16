"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, UserRound } from "lucide-react";
import { useChatStore } from "@/lib/store";

export function AccountMenu({ onKnowledge }: { onKnowledge: () => void }) {
  const user = useChatStore(s => s.user);
  const locale = useChatStore(s => s.locale);
  const logout = useChatStore(s => s.logout);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const hoverOpened = useRef(false);
  const keep = () => clearTimeout(timer.current);
  const leave = () => {
    keep();
    if (hoverOpened.current) timer.current = setTimeout(() => setOpen(false), 250);
  };
  const pinOpen = () => { keep(); hoverOpened.current = false; };
  useEffect(() => () => clearTimeout(timer.current), []);
  const mn = locale === "mn";
  const signedIn = user && !user.is_guest;
  const item = "block cursor-pointer rounded-lg px-3 py-2.5 text-[13px] font-medium outline-none data-[highlighted]:bg-white/[0.07] data-[highlighted]:text-white";
  const accountLabel = mn ? "Бүртгэл" : "Account";
  const account = signedIn ? user.full_name?.trim() || user.email || accountLabel : accountLabel;
  return <Menu.Root open={open} onOpenChange={value => { keep(); setOpen(value); }} modal={false}>
    <Menu.Trigger
      onPointerEnter={e => {
        keep();
        if (e.pointerType === "mouse" && !open) {
          timer.current = setTimeout(() => { hoverOpened.current = true; setOpen(true); }, 140);
        }
      }}
      onPointerLeave={leave}
      onPointerDown={e => {
        if (e.button === 0 && !e.ctrlKey) {
          // Radix normally toggles on pointer-down. A click after hover pins
          // the open menu instead of immediately closing it.
          if (open && hoverOpened.current) e.preventDefault();
          pinOpen();
        }
      }}
      onKeyDown={pinOpen}
      className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-neutral-100 outline-none hover:bg-white/[0.045] focus-visible:ring-2 focus-visible:ring-neutral-300 data-[state=open]:bg-white/[0.06]">
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 bg-neutral-900 text-sm font-medium text-neutral-200">
        {signedIn ? Array.from(account.trim())[0]?.toLocaleUpperCase(locale) : <UserRound size={16} strokeWidth={1.5} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{account}</span>
        <span className="mt-0.5 block truncate text-[11px] text-neutral-400">{mn ? "Профайл ба төлбөр" : "Profile & billing"}</span>
      </span>
      <ChevronDown aria-hidden size={15} strokeWidth={1.5} className="shrink-0 rotate-180 text-neutral-400 group-data-[state=open]:rotate-0" />
    </Menu.Trigger>
    <Menu.Portal><Menu.Content side="top" align="start" sideOffset={8} collisionPadding={12}
      onCloseAutoFocus={e => { if (hoverOpened.current) e.preventDefault(); }}
      onPointerEnter={keep} onPointerLeave={leave} onKeyDown={pinOpen}
      className="z-[70] max-h-[var(--radix-dropdown-menu-content-available-height)] w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-white/15 bg-neutral-900 p-1.5 text-neutral-200 shadow-[0_12px_38px_rgba(0,0,0,0.45)]">
      {signedIn ? <>
        {user.email && <Menu.Label className="mb-1.5 truncate border-b border-white/10 px-3 pb-2.5 pt-2 text-xs text-neutral-400">{user.email}</Menu.Label>}
        <Menu.Item asChild className={item}><Link href="/profile">{mn ? "Миний профайл" : "My profile"}</Link></Menu.Item>
      </> : <Menu.Item asChild className={item}><Link href="/login">{mn ? "Нэвтрэх / Бүртгүүлэх" : "Sign in / Register"}</Link></Menu.Item>}
      <Menu.Item asChild className={item}><Link href="/pricing">{mn ? "Багц ба төлбөр" : "Plans & billing"}</Link></Menu.Item>
      {signedIn && user.role === "admin" && <>
        <Menu.Item onSelect={onKnowledge} className={item}>{mn ? "Мэдлэгийн сан" : "Knowledge base"}</Menu.Item>
        <Menu.Item asChild className={item}><Link href="/admin">{mn ? "Удирдлага" : "Admin"}</Link></Menu.Item>
      </>}
      {signedIn && <>
        <Menu.Separator className="mx-1.5 my-1.5 h-px bg-white/10" />
        <Menu.Item onSelect={logout} className={`${item} text-neutral-300`}>{mn ? "Гарах" : "Sign out"}</Menu.Item>
      </>}
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}
