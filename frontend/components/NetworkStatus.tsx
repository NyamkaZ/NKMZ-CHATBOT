"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useChatStore } from "@/lib/store";

/** Offline banner + multi-tab logout sync */
export function NetworkStatus() {
  const [online, setOnline] = useState(true);
  const { logout, loadAuth } = useChatStore();

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      toast.success(
        useChatStore.getState().locale === "mn"
          ? "Интернет холбогдлоо"
          : "Back online"
      );
    };
    const goOffline = () => {
      setOnline(false);
      toast.error(
        useChatStore.getState().locale === "mn"
          ? "Интернет тасарлаа"
          : "You are offline"
      );
    };

    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // Multi-tab logout
    const onStorage = (e: StorageEvent) => {
      if (e.key === "auth_logout") {
        useChatStore.setState({
          user: null,
          chats: [],
          currentChatId: null,
          messagesByChat: {},
          usage: null,
        });
        loadAuth().then(() => {
          useChatStore.getState().ensureGuest();
          useChatStore.getState().loadChats();
        });
      }
      if (e.key === "access_token" && e.newValue && e.oldValue !== e.newValue) {
        loadAuth();
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadAuth, logout]);

  if (online) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[100] bg-destructive text-destructive-foreground text-center text-xs py-1.5 px-3">
      {useChatStore.getState().locale === "mn"
        ? "Интернет холболт байхгүй — зарим үйлдэл ажиллахгүй"
        : "No internet connection — some actions may fail"}
    </div>
  );
}
