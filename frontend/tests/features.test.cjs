const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./register-typescript.cjs");
const { describeError, handleResponse } = require("../lib/api.ts");
const { sortChats } = require("../lib/store.ts");
const { groupChats } = require("../components/chat/chatGroups.ts");

test("validation errors become a readable sentence, never raw JSON", async () => {
  const detail = [
    { type: "value_error", loc: ["body", "email"], msg: "value is not a valid email address" },
    { type: "value_error", loc: ["body", "password"], msg: "Value error, Password must be at most 72 UTF-8 bytes" },
    { type: "value_error", loc: ["body", "password"], msg: "Value error, Password must be at most 72 UTF-8 bytes" },
  ];
  assert.equal(describeError(detail), "value is not a valid email address Password must be at most 72 UTF-8 bytes");
  assert.equal(describeError("Email already registered"), "Email already registered");
  assert.equal(describeError({ message: "Nope" }), "Nope");
  assert.equal(describeError(null), "");

  const response = new Response(JSON.stringify({ detail }), { status: 422, statusText: "Unprocessable Entity" });
  await assert.rejects(handleResponse(response, true), error => {
    assert.equal(error.status, 422);
    assert.ok(!error.message.includes("{"), error.message);
    return true;
  });
  // A body without a usable message falls back to the status text.
  const empty = new Response(JSON.stringify({ detail: {} }), { status: 500, statusText: "Server Error" });
  await assert.rejects(handleResponse(empty, true), { message: "Server Error" });
});

test("pinned chats sort first, then by most recent update", () => {
  const chats = [
    { id: "old", updated_at: "2026-01-01T00:00:00Z" },
    { id: "pinned-old", updated_at: "2025-06-01T00:00:00Z", is_pinned: true },
    { id: "new", updated_at: "2026-03-01T00:00:00Z" },
    { id: "pinned-new", updated_at: "2026-02-01T00:00:00Z", is_pinned: true },
  ];
  const before = chats.map(chat => chat.id);
  assert.deepEqual(sortChats(chats).map(chat => chat.id), ["pinned-new", "pinned-old", "new", "old"]);
  assert.deepEqual(chats.map(chat => chat.id), before, "the input list is not mutated");
});

test("history is grouped by local day with pinned chats on top", () => {
  const now = new Date(2026, 10, 16, 15, 0, 0);
  const at = (daysAgo, hour = 12) => new Date(2026, 10, 16 - daysAgo, hour).toISOString();
  const groups = groupChats([
    { id: "pin", updated_at: at(40), is_pinned: true },
    { id: "just-now", updated_at: at(0, 14) },
    { id: "midnight", updated_at: new Date(2026, 10, 16, 0, 0, 0).toISOString() },
    { id: "late-yesterday", updated_at: new Date(2026, 10, 15, 23, 59, 59).toISOString() },
    { id: "three-days", updated_at: at(3) },
    { id: "seven-days", updated_at: at(7) },
    { id: "eight-days", updated_at: at(8) },
    { id: "future", updated_at: at(-1) },
  ], now);
  assert.deepEqual(groups.map(group => [group.key, group.chats.map(chat => chat.id)]), [
    ["pinned", ["pin"]],
    ["today", ["just-now", "midnight", "future"]],
    ["yesterday", ["late-yesterday"]],
    ["previous7Days", ["three-days", "seven-days"]],
    ["older", ["eight-days"]],
  ]);
  assert.deepEqual(groupChats([], now), []);
});

test("pinning moves the chat at once and rolls back when the server refuses", async () => {
  const { api } = require("../lib/api.ts");
  const { useChatStore: store } = require("../lib/store.ts");
  const original = api.pinChat;
  const order = () => store.getState().chats.map(chat => chat.id + (chat.is_pinned ? "*" : ""));
  try {
    store.setState({ chats: [
      { id: "a", title: "A", is_title_generated: true, updated_at: "2026-02-01T00:00:00Z" },
      { id: "b", title: "B", is_title_generated: true, updated_at: "2026-01-01T00:00:00Z" },
    ] });
    let release;
    api.pinChat = () => new Promise(resolve => { release = resolve; });
    const pending = store.getState().pinChat("b", true);
    assert.deepEqual(order(), ["b*", "a"], "shown before the server answers");
    release({});
    await pending;

    api.pinChat = async () => { throw new Error("offline"); };
    await assert.rejects(store.getState().pinChat("b", false), /offline/);
    assert.deepEqual(order(), ["b*", "a"], "a refused change is undone");
  } finally {
    api.pinChat = original;
    store.setState({ chats: [] });
  }
});

test("limit errors carry the time a retry can succeed", async () => {
  const { formatCountdown, retryTime } = require("../lib/countdown.ts");
  assert.equal(formatCountdown(0), "00:00");
  assert.equal(formatCountdown(-5000), "00:00");
  assert.equal(formatCountdown(41_200), "00:42", "rounds up so it never shows 00:00 early");
  assert.equal(formatCountdown(8_049_000), "2:14:09");
  assert.equal(retryTime("42", 1000), 43_000);
  assert.equal(retryTime(null, 1000), undefined);
  assert.equal(retryTime("soon", 1000), undefined);
  assert.equal(retryTime("0", 1000), undefined);

  const before = Date.now();
  const limited = new Response(JSON.stringify({ detail: "Rate limit exceeded. Please wait a minute." }),
    { status: 429, headers: { "Retry-After": "30" } });
  await assert.rejects(handleResponse(limited, true), error => {
    assert.equal(error.status, 429);
    assert.ok(error.retryAt >= before + 30_000 && error.retryAt <= Date.now() + 30_000);
    return true;
  });
  const plain = new Response(JSON.stringify({ detail: "Nope" }), { status: 400 });
  await assert.rejects(handleResponse(plain, true), error => error.retryAt === undefined);
});

test("the install prompt is offered once and only while the browser allows it", async () => {
  const listenersByType = {};
  const previousWindow = global.window;
  global.window = { addEventListener: (type, handler) => { listenersByType[type] = handler; } };
  try {
    const pwa = require("../lib/pwa.ts");
    let changes = 0;
    const unsubscribe = pwa.subscribeInstall(() => { changes++; });
    pwa.initPwa();
    pwa.initPwa(); // idempotent
    assert.equal(pwa.canInstall(), false);
    assert.equal(await pwa.promptInstall(), false, "nothing to prompt yet");

    let prevented = false, prompted = 0;
    const event = { preventDefault: () => { prevented = true; }, prompt: async () => { prompted++; },
      userChoice: Promise.resolve({ outcome: "accepted" }) };
    listenersByType.beforeinstallprompt(event);
    assert.ok(prevented, "the browser's own banner is suppressed");
    assert.equal(pwa.canInstall(), true);
    assert.equal(await pwa.promptInstall(), true);
    assert.equal(prompted, 1);
    assert.equal(pwa.canInstall(), false, "a prompt event cannot be reused");
    assert.equal(await pwa.promptInstall(), false);

    listenersByType.beforeinstallprompt({ ...event, userChoice: Promise.resolve({ outcome: "dismissed" }) });
    listenersByType.appinstalled();
    assert.equal(pwa.canInstall(), false, "nothing to offer once installed");
    assert.ok(changes >= 4);
    unsubscribe();
  } finally {
    global.window = previousWindow;
  }
});
