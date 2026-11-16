const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("./register-typescript.cjs");
const { api } = require("../lib/api.ts");
const { useChatStore: store } = require("../lib/store.ts");
const originalApi = { ...api };

class FakeSource {
  static CLOSED = 2;
  static instances = [];
  readyState = 1;
  listeners = {};
  constructor() { FakeSource.instances.push(this); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  close() { this.readyState = 2; }
  emit(name, value) { this.listeners[name]?.({ data: JSON.stringify(value) }); }
}

function sendResult(status = "thinking") {
  return {
    chat: { id: "chat", title: "Chat" },
    user_message: { id: "user", content: "Hi" },
    assistant_message: { id: "assistant", generation_id: "gen", content: "", status },
  };
}

beforeEach(() => {
  for (const source of FakeSource.instances) source.close();
  FakeSource.instances = [];
  const storage = new Map();
  global.window = {};
  global.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  global.EventSource = FakeSource;
  Object.assign(api, originalApi, {
    listChats: async () => [], getUsage: async () => ({}),
    me: async () => ({ id: "signed-in", is_guest: false }),
  });
  store.setState({ chats: [], messagesByChat: {}, generating: {}, user: null,
    currentChatId: null, currentChatTitle: null, historyError: false,
    isSending: false, usage: null, searchQuery: "", isLoadingChats: false, chatListError: false });
});

test("slower old searches cannot replace newer chat results", async () => {
  localStorage.setItem("access_token", "token");
  const pending = new Map();
  api.listChats = query => new Promise(resolve => pending.set(query, resolve));
  store.getState().setSearchQuery("old");
  const oldRequest = store.getState().loadChats();
  await new Promise(setImmediate);
  store.getState().setSearchQuery("new");
  const newRequest = store.getState().loadChats();
  await new Promise(setImmediate);
  pending.get("new")([{ id: "new-result" }]);
  await newRequest;
  pending.get("old")([{ id: "old-result" }]);
  await oldRequest;
  assert.deepEqual(store.getState().chats, [{ id: "new-result" }]);
});

test("an older search finishing does not dismiss the latest search's loading state", async () => {
  localStorage.setItem("access_token", "token");
  const pending = [];
  api.listChats = () => new Promise(resolve => pending.push(resolve));
  const first = store.getState().loadChats();
  await new Promise(setImmediate);
  const second = store.getState().loadChats();
  await new Promise(setImmediate);
  pending[0]([]);
  await first;
  assert.equal(store.getState().isLoadingChats, true);
  pending[1]([]);
  await second;
  assert.equal(store.getState().isLoadingChats, false);
});

test("search results for text edited during the debounce wait are ignored", async () => {
  localStorage.setItem("access_token", "token");
  let finish;
  api.listChats = () => new Promise(resolve => { finish = resolve; });
  store.getState().setSearchQuery("old");
  const request = store.getState().loadChats();
  await new Promise(setImmediate);
  store.getState().setSearchQuery("new");
  finish([{ id: "old-result" }]);
  await request;
  assert.deepEqual(store.getState().chats, []);
});

test("failed chat loading preserves conversations and a retry clears the error", async () => {
  localStorage.setItem("access_token", "token");
  store.setState({ chats: [{ id: "existing" }] });
  api.listChats = async () => { throw new TypeError("Offline"); };
  await store.getState().loadChats();
  assert.equal(store.getState().chatListError, true);
  assert.deepEqual(store.getState().chats, [{ id: "existing" }]);
  api.listChats = async () => [{ id: "fresh" }];
  await store.getState().loadChats();
  assert.equal(store.getState().chatListError, false);
  assert.deepEqual(store.getState().chats, [{ id: "fresh" }]);
});

test("resetting the session in another tab clears search and discards the previous account's response", async () => {
  localStorage.setItem("access_token", "token");
  store.getState().setSearchQuery("work");
  let finish;
  api.listChats = () => new Promise(resolve => { finish = resolve; });
  const request = store.getState().loadChats();
  await new Promise(setImmediate);
  store.getState().resetSession();
  assert.equal(store.getState().isLoadingChats, false);
  assert.equal(store.getState().searchQuery, "");
  finish([{ id: "previous-account" }]);
  await request;
  assert.deepEqual(store.getState().chats, []);
  assert.equal(store.getState().chatListError, false);
});

test("concurrent initialization creates exactly one guest session", async () => {
  let calls = 0;
  api.createGuest = async () => { calls++; await new Promise(setImmediate); return { guest_id: "guest", access_token: "token" }; };
  await Promise.all([store.getState().ensureGuest(), store.getState().ensureGuest()]);
  assert.equal(calls, 1);
  assert.equal(localStorage.getItem("access_token"), "token");
});

test("the open chat keeps its title during search, rename and navigation back to new chat", async () => {
  localStorage.setItem("access_token", "token");
  api.getChat = async () => ({ id: "first", title: "Санаанууд", messages: [] });
  await store.getState().selectChat("first");
  store.getState().setSearchQuery("second");
  api.listChats = async () => [{ id: "second", title: "Second" }];
  await store.getState().loadChats();
  assert.equal(store.getState().currentChatTitle, "Санаанууд");
  api.renameChat = async () => {};
  await store.getState().renameChat("first", "Шинэ нэр");
  assert.equal(store.getState().currentChatTitle, "Шинэ нэр");
  store.getState().createNewChat();
  assert.equal(store.getState().currentChatTitle, null);
});

test("an unreadable history can be retried; it cannot receive a send until loaded", async () => {
  api.getChat = async () => { throw new Error("Offline"); };
  await store.getState().selectChat("chat");
  assert.equal(store.getState().historyError, true);
  assert.equal(store.getState().messagesByChat.chat, undefined);
  await assert.rejects(store.getState().sendMessage("hello"));
  api.getChat = async () => ({ id: "chat", messages: [] });
  await store.getState().selectChat("chat");
  assert.equal(store.getState().historyError, false);
  assert.deepEqual(store.getState().messagesByChat.chat, []);
});

test("a late history refresh cannot replace a newly started response", async () => {
  localStorage.setItem("access_token", "token");
  store.setState({ messagesByChat: { chat: [] } });
  let finish;
  api.getChat = () => new Promise(resolve => { finish = resolve; });
  const refresh = store.getState().selectChat("chat");
  api.sendMessage = async () => sendResult();
  await store.getState().sendMessage("hello");
  finish({ id: "chat", messages: [] });
  await refresh;
  assert.equal(store.getState().messagesByChat.chat.at(-1).id, "assistant");
  assert.equal(FakeSource.instances.length, 1);
});

test("a failed deletion leaves the active response stream connected", async () => {
  localStorage.setItem("access_token", "token");
  api.sendMessage = async () => sendResult();
  await store.getState().sendMessage("hello");
  const stream = FakeSource.instances[0];
  api.deleteChat = async () => { throw new Error("Offline"); };
  await assert.rejects(store.getState().deleteChat("chat"));
  assert.equal(stream.readyState, 1);
  stream.emit("token", { token: "still responding" });
  assert.equal(store.getState().messagesByChat.chat.at(-1).content, "still responding");
  api.deleteChat = async () => {};
  await store.getState().deleteChat("chat");
  assert.equal(stream.readyState, FakeSource.CLOSED);
  assert.equal(store.getState().messagesByChat.chat, undefined);
});

test("opening a fresh chat while the first send is pending preserves the new selection", async () => {
  localStorage.setItem("access_token", "token");
  let finish;
  api.sendMessage = () => new Promise(resolve => { finish = resolve; });
  const sending = store.getState().sendMessage("hello");
  await new Promise(setImmediate);
  store.getState().createNewChat();
  finish(sendResult("completed"));
  await sending;
  assert.equal(store.getState().currentChatId, null);
  assert.equal(store.getState().messagesByChat.chat.length, 2);
});

test("network failures do not log out an authenticated user", async () => {
  localStorage.setItem("access_token", "token");
  store.setState({ user: { id: "signed-in", is_guest: false } });
  api.me = async () => { throw new TypeError("Failed to fetch"); };
  await store.getState().loadAuth();
  assert.equal(localStorage.getItem("access_token"), "token");
  assert.equal(store.getState().user.id, "signed-in");
});

test("duplicate sends preserve the currently running stream", async () => {
  const source = new FakeSource();
  store.setState({ currentChatId: "chat", generating: { chat: { eventSource: source, status: "thinking" } } });
  api.sendMessage = async () => assert.fail("must not send a second request");
  await store.getState().sendMessage("second");
  assert.equal(source.readyState, 1);
});

test("sending in another chat does not force navigation back", async () => {
  localStorage.setItem("access_token", "token");
  let finish;
  api.sendMessage = () => new Promise((resolve) => { finish = resolve; });
  const request = store.getState().sendMessage("hello");
  await new Promise(setImmediate);
  store.setState({ currentChatId: "other" });
  finish(sendResult());
  await request;
  assert.equal(store.getState().currentChatId, "other");
  assert.ok(store.getState().generating.chat);
});

test("empty replay replaces stale partial content and done replaces tokens", async () => {
  localStorage.setItem("access_token", "token");
  api.sendMessage = async () => sendResult();
  await store.getState().sendMessage("hello");
  const source = FakeSource.instances[0];
  source.emit("token", { token: "old" });
  source.emit("catchup", { content: "", status: "streaming" });
  source.emit("token", { token: "new" });
  assert.equal(store.getState().messagesByChat.chat.at(-1).content, "new");
  source.emit("done", { status: "completed", content: "final" });
  assert.equal(store.getState().messagesByChat.chat.at(-1).content, "final");
  assert.equal(store.getState().generating.chat, undefined);
});

test("stop waits for the authoritative server response", async () => {
  localStorage.setItem("access_token", "token");
  api.sendMessage = async () => sendResult();
  api.stopGeneration = async () => ({});
  await store.getState().sendMessage("hello");
  await store.getState().stopGenerating("chat");
  assert.equal(FakeSource.instances[0].readyState, 1);
  assert.ok(store.getState().generating.chat);
});

test("logout closes streams and ignores late stream events", async () => {
  localStorage.setItem("access_token", "token");
  api.sendMessage = async () => sendResult();
  api.createGuest = async () => ({ guest_id: "new", access_token: "new-token" });
  await store.getState().sendMessage("hello");
  const source = FakeSource.instances[0];
  store.getState().logout();
  source.emit("token", { token: "private stale reply" });
  assert.equal(source.readyState, 2);
  assert.deepEqual(store.getState().generating, {});
  assert.deepEqual(store.getState().messagesByChat, {});
  await new Promise(setImmediate);
});

test("completed FAQ replies do not start another stream", async () => {
  localStorage.setItem("access_token", "token");
  api.sendMessage = async () => sendResult("completed");
  await store.getState().sendMessage("hours");
  assert.equal(FakeSource.instances.length, 0);
});

test("a late send response cannot restore a logged-out conversation", async () => {
  localStorage.setItem("access_token", "token");
  let finish;
  api.sendMessage = () => new Promise((resolve) => { finish = resolve; });
  api.createGuest = async () => ({ guest_id: "new", access_token: "new-token" });
  const request = store.getState().sendMessage("hello");
  await new Promise(setImmediate);
  store.getState().logout();
  finish(sendResult());
  await request;
  assert.deepEqual(store.getState().messagesByChat, {});
  assert.equal(FakeSource.instances.length, 0);
  await new Promise(setImmediate);
});
