"use client";

import { useEffect } from "react";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatArea } from "@/components/chat/ChatArea";
import { NetworkStatus } from "@/components/NetworkStatus";
import { useChatStore } from "@/lib/store";

export default function HomePage() {
  const loadAuth = useChatStore(s => s.loadAuth);
  const ensureGuest = useChatStore(s => s.ensureGuest);
  const loadUsage = useChatStore(s => s.loadUsage);
  const loadChats = useChatStore(s => s.loadChats);

  useEffect(() => {
    (async () => {
      await loadAuth();
      await ensureGuest();
      await loadAuth();
      await loadChats();
      await loadUsage();
    })().catch(console.error);
  }, [loadAuth, ensureGuest, loadChats, loadUsage]);

  return (
    <div className="workspace-frame fixed inset-0 flex h-[100dvh] w-full overflow-hidden">
      <NetworkStatus />
      <Sidebar />
      <ChatArea />
    </div>
  );
}
