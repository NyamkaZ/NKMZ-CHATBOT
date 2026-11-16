/**
 * Install support. Browsers that can install the app fire `beforeinstallprompt`
 * once; the event is kept so the Ctrl+K palette can offer "Install app" later.
 * (iOS Safari never fires it: there the user installs from the Share menu.)
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
let started = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function canInstall(): boolean {
  return deferred !== null;
}

/** Show the browser's install dialog. Resolves true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null; // a prompt event can be used only once
  notify();
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}

/** Call once in the browser. Safe to call again. */
export function initPwa(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault(); // no automatic banner; the palette offers it
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  // The worker caches build files, which only have stable names in production.
  if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Installing and offline support are optional; the app works without them. */
    });
  }
}
