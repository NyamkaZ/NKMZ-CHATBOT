"use client";

import { useEffect } from "react";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatArea } from "@/components/chat/ChatArea";
import { NetworkStatus } from "@/components/NetworkStatus";
import Strands from "@/components/Strands";
import { CommandPalette } from "@/components/chat/CommandPalette";
import { useChatStore } from "@/lib/store";

export default function HomePage() {
  const { loadAuth, ensureGuest, loadUsage, loadChats } = useChatStore();

  useEffect(() => {
    (async () => {
      await loadAuth();
      await ensureGuest();
      await loadAuth();
      await loadChats();
      await loadUsage();
    })();
  }, []);

  return (
    <div className="chat-atmosphere relative flex h-[100dvh] w-full overflow-hidden">
      <Strands
        colors={["#0d9488", "#14b8a6", "#5eead4"]}
        count={4}
        speed={0.4}
        amplitude={1}
        waviness={1}
        thickness={0.6}
        glow={2.2}
        taper={2.4}
        spread={1.1}
        intensity={0.35}
        saturation={1.1}
        opacity={0.5}
        scale={1.6}
      />
      <div className="relative z-10 flex h-full w-full">
        <CommandPalette />
        <NetworkStatus />
        <Sidebar />
        <ChatArea />
      </div>
    </div>
  );
}
