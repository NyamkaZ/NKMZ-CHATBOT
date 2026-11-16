const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./register-typescript.cjs");
const { composerDrafts } = require("../components/chat/composerDrafts.ts");

test("a failed first send in a new chat restores its draft without replacing another conversation's text", () => {
  const submitted = "  What was the date? ";
  let drafts = composerDrafts(new Map(), { type: "edit", key: null, text: submitted });
  drafts = composerDrafts(drafts, { type: "send", key: null, keepText: false });
  drafts = composerDrafts(drafts, { type: "edit", key: "work", text: "Release notes" });
  drafts = composerDrafts(drafts, { type: "failed", key: null, text: submitted, cause: "Offline" });
  assert.equal(drafts.get(null).text, submitted);
  assert.equal(drafts.get("work").text, "Release notes");
  assert.equal(drafts.get("work").failure, undefined);
});

test("a follow-up typed while sending survives a failure, and retrying the original preserves the follow-up", () => {
  const key = "work";
  let drafts = composerDrafts(new Map(), { type: "send", key, keepText: false });
  drafts = composerDrafts(drafts, { type: "edit", key, text: "Also include the agenda" });
  drafts = composerDrafts(drafts, { type: "failed", key, text: "Summarize the meeting", cause: "Offline" });
  assert.equal(drafts.get(key).text, "Also include the agenda");
  assert.equal(drafts.get(key).failure.text, "Summarize the meeting");
  drafts = composerDrafts(drafts, { type: "send", key, keepText: true });
  drafts = composerDrafts(drafts, { type: "sent", key });
  assert.equal(drafts.get(key).text, "Also include the agenda");
  assert.equal(drafts.get(key).failure, undefined);
});
