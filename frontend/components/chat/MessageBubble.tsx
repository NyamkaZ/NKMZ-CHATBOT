"use client";

import ThoughtLine from "@/components/react-bits/ThoughtLine";
import { isValidElement, memo, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { Message, useChatStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Copy, Check, RotateCcw, AlertCircle } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { translate, type Locale } from "@/lib/i18n";
import { CodeBlock } from "./CodeBlock";

interface Props {
  message: Message;
  isLastAssistant?: boolean;
}

const REMARK = [remarkGfm];
// Unknown or missing languages are left as plain text instead of being guessed.
const REHYPE = [[rehypeHighlight, { detect: false, ignoreMissing: true }]] as NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>;

function markdownComponents(locale: Locale): Components {
  return {
    // Fenced blocks arrive as <pre><code class="language-x">; inline code has no <pre>.
    pre({ children }) {
      const code = isValidElement(children) ? (children as ReactElement<{ className?: string }>) : null;
      const language = /language-([\w+#.-]+)/.exec(code?.props.className ?? "")?.[1];
      return <CodeBlock language={language} locale={locale}>{children as ReactNode}</CodeBlock>;
    },
    code({ className, children, ...props }) {
      if (/language-|hljs/.test(className ?? "")) return <code className={className} {...props}>{children}</code>;
      return (
        <code className="rounded-md bg-muted px-1.5 py-0.5 text-[0.85em] font-mono" {...props}>
          {children}
        </code>
      );
    },
    table({ children }) {
      return <div className="my-4 overflow-x-auto"><table className="my-0">{children}</table></div>;
    },
    a({ children, href }) {
      return <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>;
    },
  };
}
const COMPONENTS = { en: markdownComponents("en"), mn: markdownComponents("mn") };

export const MessageBubble = memo(function MessageBubble({ message, isLastAssistant }: Props) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const { regenerate, currentChatId, t, locale, isGenerating } = useChatStore(useShallow(s => ({
    regenerate: s.regenerate,
    currentChatId: s.currentChatId,
    t: s.t,
    locale: s.locale,
    isGenerating: !!s.currentChatId && s.generating[s.currentChatId]?.messageId === message.id &&
      ["thinking", "streaming"].includes(s.generating[s.currentChatId].status),
  })));
  const isUser = message.role === "user";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content || "");
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(translate(locale, "copyFailed"));
    }
  };

  const handleRegenerate = async () => {
    if (!currentChatId) return;
    try {
      await regenerate(currentChatId, message.id);
    } catch (error) {
      toast.error(friendlyError(error, useChatStore.getState().locale, "sendFailed"));
    }
  };

  return (
    <div
      className={cn(
        "group relative flex gap-3 md:gap-3.5 px-3 py-4 md:px-5",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "min-w-0 space-y-2",
          isUser ? "max-w-[85%] sm:max-w-[75%]" : "flex-1 max-w-[min(100%,42rem)]"
        )}
      >
        {isUser && <span className="sr-only">{locale === "mn" ? "Та" : "You"}</span>}
        {!isUser && <ThoughtLine
          key={message.generation_id || message.id}
          working={isGenerating || ["pending", "thinking", "streaming"].includes(message.status)}
          label={message.content ? (locale === "mn" ? "Хариулт бичиж байна…" : "Writing a reply…") : t("thinking")}
          doneLabel={message.status === "failed" ? (locale === "mn" ? "Алдаа гарлаа" : "Response failed") : message.status === "stopped" ? (locale === "mn" ? "Зогсоосон" : "Stopped") : (locale === "mn" ? "Хариулт бэлэн" : "Response finished")}
          steps={message.content ? [locale === "mn" ? "Хүсэлт хүлээн авсан" : "Request received", locale === "mn" ? "Хариулт бичих" : "Writing the response"] : [locale === "mn" ? "Хариулт хүлээж байна" : "Waiting for a response"]}
        />}
        <div
          className={cn(
            isUser
              ? "rounded-2xl rounded-br-md border border-white/15 bg-neutral-900 px-4 py-2.5 text-[15px] leading-relaxed text-neutral-100 whitespace-pre-wrap break-words"
              : "prose prose-sm dark:prose-invert max-w-none break-words prose-code:before:content-none prose-code:after:content-none prose-p:leading-relaxed prose-headings:font-display"
          )}
        >
          {message.status === "failed" ? (
            <div className="not-prose flex flex-col gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {t("generationFailed")}
                  {message.error_message ? `: ${message.error_message}` : ""}
                </span>
              </div>
              {isLastAssistant && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit h-8 rounded-xl"
                  onClick={handleRegenerate}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  {t("retry")}
                </Button>
              )}
            </div>
          ) : isUser ? (
            message.content
          ) : (
            <>
              <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS[locale]}>
                {message.content || (isGenerating ? " " : "")}
              </ReactMarkdown>
              {isGenerating && message.content ? (
                <span aria-hidden="true" className="inline-block w-1.5 h-4 ml-0.5 bg-primary/80 animate-pulse align-middle rounded-sm" />
              ) : null}
            </>
          )}
        </div>

        {!isUser && message.content && message.status !== "failed" && (
          <div
            className={cn(
              "flex items-center gap-0.5 transition-opacity",
              isLastAssistant ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
              title={t("copy")}
              aria-label={t("copy")}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-foreground" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            {isLastAssistant && !isGenerating && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={handleRegenerate}
                title={t("regenerate")}
                aria-label={t("regenerate")}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
