/** Drafts live only in this mounted workspace. The null key is the new chat. */
export type DraftKey = string | null;

export interface ComposerDraft {
  text: string;
  sending?: boolean;
  changedAfterSend?: boolean;
  failure?: { text: string; cause: unknown };
}

type DraftAction =
  | { type: "edit"; key: DraftKey; text: string }
  | { type: "send"; key: DraftKey; keepText: boolean }
  | { type: "sent"; key: DraftKey }
  | { type: "failed"; key: DraftKey; text: string; cause: unknown };

export function composerDrafts(
  drafts: Map<DraftKey, ComposerDraft>,
  action: DraftAction,
): Map<DraftKey, ComposerDraft> {
  const current = drafts.get(action.key) ?? { text: "" };
  let next: ComposerDraft;
  switch (action.type) {
    case "edit":
      next = { ...current, text: action.text, changedAfterSend: current.sending };
      break;
    case "send":
      next = { text: action.keepText ? current.text : "", sending: true, changedAfterSend: action.keepText };
      break;
    case "sent":
      next = { text: current.text };
      break;
    case "failed":
      next = {
        text: current.changedAfterSend ? current.text : action.text,
        failure: { text: action.text, cause: action.cause },
      };
      break;
  }
  const result = new Map(drafts);
  if (next.text || next.failure || next.sending) result.set(action.key, next);
  else result.delete(action.key);
  return result;
}
