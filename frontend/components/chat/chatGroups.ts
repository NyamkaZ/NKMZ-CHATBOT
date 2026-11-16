import type { TranslationKey } from "@/lib/i18n";

export type ChatGroupKey = Extract<TranslationKey, "pinned" | "today" | "yesterday" | "previous7Days" | "older">;

const ORDER: ChatGroupKey[] = ["pinned", "today", "yesterday", "previous7Days", "older"];
const DAY = 24 * 60 * 60 * 1000;

/**
 * Bucket conversations for the sidebar: pinned first, then by how recently
 * they were updated in the viewer's local time. Order inside a bucket is kept.
 */
export function groupChats<T extends { is_pinned?: boolean; updated_at: string }>(
  chats: T[],
  now: Date = new Date(),
): { key: ChatGroupKey; chats: T[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets = new Map<ChatGroupKey, T[]>();
  for (const chat of chats) {
    const updated = new Date(chat.updated_at).getTime();
    const key: ChatGroupKey = chat.is_pinned ? "pinned"
      : !(updated < startOfToday) ? "today"            // also catches clock skew and bad dates
      : updated >= startOfToday - DAY ? "yesterday"
      : updated >= startOfToday - 7 * DAY ? "previous7Days"
      : "older";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(chat);
    else buckets.set(key, [chat]);
  }
  return ORDER.filter(key => buckets.has(key)).map(key => ({ key, chats: buckets.get(key)! }));
}
