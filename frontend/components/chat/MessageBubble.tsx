"use client";

import { useState } from "react";
import { Message, useChatStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Copy, Check, RotateCcw, AlertCircle, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  message: Message;
  isLastAssistant?: boolean;
}

export function MessageBubble({ message, isLastAssistant }: Props) {
  const [copied, setCopied] = useState(false);
  const { regenerate, generating, currentChatId, t } = useChatStore();
  const isUser = message.role === "user";
  const isGenerating =
    !!currentChatId &&
    generating[currentChatId]?.messageId === message.id &&
    (generating[currentChatId].status === "thinking" ||
      generating[currentChatId].status === "streaming");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        "group relative flex gap-3 md:gap-3.5 px-3 py-4 md:px-5",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-teal-700 text-primary-foreground shadow-soft mt-0.5">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
      )}

      <div
        className={cn(
          "min-w-0 space-y-2",
          isUser ? "max-w-[85%] sm:max-w-[75%]" : "flex-1 max-w-[min(100%,42rem)]"
        )}
      >
        <div
          className={cn(
            isUser
              ? "rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2.5 shadow-soft text-[15px] leading-relaxed whitespace-pre-wrap break-words"
              : "prose prose-sm dark:prose-invert max-w-none break-words prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-border/60 prose-pre:text-zinc-100 prose-code:before:content-none prose-code:after:content-none prose-p:leading-relaxed prose-headings:font-display"
          )}
        >
          {message.status === "thinking" && !message.content ? (
            <div className="flex items-center gap-2 text-muted-foreground py-1">
              <span className="font-medium text-sm">{t("thinking")}</span>
              <span className="thinking-dots inline-flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
            </div>
          ) : message.status === "failed" ? (
            <div className="flex flex-col gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
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
                  onClick={() =>
                    currentChatId && regenerate(currentChatId, message.id)
                  }
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  {t("retry")}
                </Button>
              )}
            </div>
          ) : isUser ? (
            message.content
          ) : (
            <>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const isBlock = /language-/.test(className || "");
                    if (isBlock) {
                      return (
                        <code
                          className={cn(
                            "block rounded-xl p-3.5 text-[13px] overflow-x-auto",
                            className
                          )}
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code
                        className="rounded-md bg-muted px-1.5 py-0.5 text-[0.85em] font-mono"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {message.content || (isGenerating ? " " : "")}
              </ReactMarkdown>
              {isGenerating && message.content ? (
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-primary/80 animate-pulse align-middle rounded-sm" />
              ) : null}
            </>
          )}
        </div>

        {!isUser && (message.content || message.status === "failed") && (
          <div
            className={cn(
              "flex items-center gap-0.5 transition-opacity",
              isLastAssistant || message.status === "failed"
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100"
            )}
          >
            {message.content ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={handleCopy}
                title={t("copy")}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            ) : null}

            {isLastAssistant &&
              !isGenerating &&
              message.status !== "failed" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    currentChatId && regenerate(currentChatId, message.id)
                  }
                  title={t("regenerate")}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground text-xs font-semibold mt-0.5">
          U
        </div>
      )}
    </div>
  );
}
