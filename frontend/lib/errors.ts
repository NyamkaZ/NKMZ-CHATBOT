import type { Locale, TranslationKey } from "./i18n";
import { translate } from "./i18n";

/** Raw browser/network messages we never want to show as-is */
const NETWORK_PATTERNS = [
  /failed to fetch/i,
  /networkerror/i,
  /network request failed/i,
  /load failed/i,
  /fetch failed/i,
  /connection refused/i,
  /econnrefused/i,
  /err_connection/i,
  /err_empty_response/i,
  /err_network/i,
  /timeout/i,
  /aborted/i,
  /network error/i,
];

export function isNetworkError(err: unknown): boolean {
  const msg =
    typeof err === "string"
      ? err
      : err instanceof Error
      ? err.message
      : String(err ?? "");
  return NETWORK_PATTERNS.some((re) => re.test(msg));
}

/**
 * Map technical errors (e.g. "Failed to fetch") to friendly MN/EN text.
 */
export function friendlyError(
  err: unknown,
  locale: Locale,
  fallbackKey: TranslationKey = "pleaseWait"
): string {
  if (isNetworkError(err)) {
    return translate(locale, "networkBusy");
  }
  if (err instanceof Error && err.message?.trim()) {
    // Keep intentional backend messages (rate limit, daily limit, etc.)
    if (!NETWORK_PATTERNS.some((re) => re.test(err.message))) {
      return err.message;
    }
  }
  if (typeof err === "string" && err.trim() && !isNetworkError(err)) {
    return err;
  }
  return translate(locale, fallbackKey);
}
