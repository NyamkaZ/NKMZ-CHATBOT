"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { translate, type Locale } from "@/lib/i18n";

/** A fenced code block from an answer: language label, copy button, scrollable body. */
export function CodeBlock({ language, locale, children }: { language?: string; locale: Locale; children: ReactNode }) {
  const body = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      // Read the rendered text so highlighted markup is never copied.
      await navigator.clipboard.writeText(body.current?.innerText.replace(/\n$/, "") ?? "");
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(translate(locale, "copyFailed"));
    }
  };
  const label = translate(locale, copied ? "copied" : "copyCode");

  return (
    <div className="not-prose my-4 overflow-hidden rounded-xl border border-border/60 bg-zinc-950">
      <div className="flex h-9 items-center justify-between border-b border-border/60 pl-3.5 pr-1.5">
        <span className="font-mono text-[11px] lowercase text-neutral-500">{language || "text"}</span>
        <button type="button" onClick={copy} aria-label={label}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-neutral-400 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-300">
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          <span aria-live="polite">{label}</span>
        </button>
      </div>
      <pre ref={body} className="m-0 overflow-x-auto p-3.5 font-mono text-[13px] leading-relaxed text-zinc-100 [tab-size:2]">{children}</pre>
    </div>
  );
}
