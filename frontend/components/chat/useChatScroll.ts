"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/store";

export function useChatScroll(chatId: string | null, messages: Message[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previous = useRef<{ chatId: string | null; userId?: string }>({ chatId });
  const [showLatest, setShowLatest] = useState(false);
  const userId = messages.findLast(message => message.role === "user")?.id;
  const hasMessages = messages.length > 0;

  const jumpToLatest = useCallback(() => {
    following.current = true;
    setShowLatest(false);
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  useEffect(() => {
    const changedChat = previous.current.chatId !== chatId;
    const sentMessage = userId !== undefined && previous.current.userId !== userId;
    previous.current = { chatId, userId };
    if (!hasMessages) {
      following.current = true;
      setShowLatest(false);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      return;
    }
    if (changedChat || sentMessage || following.current) jumpToLatest();
  }, [chatId, userId, messages, hasMessages, jumpToLatest]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !hasMessages) return;
    const observer = new ResizeObserver(() => {
      if (following.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [chatId, hasMessages]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    following.current = node.scrollHeight - node.clientHeight - node.scrollTop < 80;
    setShowLatest(!following.current);
  };

  return { scrollRef, onScroll, showLatest, jumpToLatest };
}
