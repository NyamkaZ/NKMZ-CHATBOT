const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** Run public/sw.js against a minimal stand-in for the service worker environment. */
function loadWorker({ online = true } = {}) {
  const handlers = {};
  const stores = new Map();
  const network = [];
  const open = async name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      addAll: async urls => { for (const url of urls) store.set(new URL(url, "https://app.test").href, `precached:${url}`); },
      put: async (request, response) => { store.set(request.url, response); },
    };
  };
  const context = {
    URL,
    Promise,
    self: {
      location: { origin: "https://app.test" },
      addEventListener: (type, handler) => { handlers[type] = handler; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open,
      keys: async () => [...stores.keys()],
      delete: async name => stores.delete(name),
      match: async request => {
        const url = typeof request === "string" ? new URL(request, "https://app.test").href : request.url;
        for (const store of stores.values()) if (store.has(url)) return store.get(url);
        return undefined;
      },
    },
    fetch: async request => {
      network.push(request.url);
      if (!online) throw new TypeError("Failed to fetch");
      return { ok: !request.url.includes("missing"), body: `network:${request.url}`, clone() { return this; } };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8"), context);

  const lifecycle = async type => { let done; handlers[type]({ waitUntil: promise => { done = promise; } }); await done; };
  /** Returns the worker's response, or undefined when it leaves the request to the browser. */
  const request = async (pathname, { method = "GET", mode = "cors", origin = "https://app.test" } = {}) => {
    let answer;
    handlers.fetch({ request: { url: origin + pathname, method, mode }, respondWith: promise => { answer = promise; } });
    return answer === undefined ? undefined : await answer;
  };
  return { lifecycle, request, stores, network };
}

test("the worker never handles API, health, write or cross-origin requests", async () => {
  const worker = loadWorker();
  await worker.lifecycle("install");
  assert.equal(await worker.request("/api/v1/chats"), undefined);
  assert.equal(await worker.request("/api/v1/stream/abc?token=x"), undefined);
  assert.equal(await worker.request("/health/ollama"), undefined);
  assert.equal(await worker.request("/_next/static/chunk.js", { method: "POST" }), undefined);
  assert.equal(await worker.request("/_next/static/chunk.js", { origin: "https://cdn.test" }), undefined);
  assert.equal(await worker.request("/some-image.png"), undefined, "unknown paths go straight to the network");
  assert.deepEqual(worker.network, []);
});

test("pages come from the network and fall back to the offline page", async () => {
  const online = loadWorker();
  await online.lifecycle("install");
  assert.equal((await online.request("/pricing", { mode: "navigate" })).body, "network:https://app.test/pricing");

  const offline = loadWorker({ online: false });
  await offline.lifecycle("install");
  assert.equal(await offline.request("/pricing", { mode: "navigate" }), "precached:/offline.html");
});

test("build files are cached after the first successful load only", async () => {
  const worker = loadWorker();
  await worker.lifecycle("install");
  const first = await worker.request("/_next/static/chunks/app.js");
  await new Promise(resolve => setImmediate(resolve)); // let the cache write finish
  const second = await worker.request("/_next/static/chunks/app.js");
  assert.equal(second, first);
  assert.equal(worker.network.length, 1, "the second load does not hit the network");

  await worker.request("/_next/static/chunks/missing.js");
  await new Promise(resolve => setImmediate(resolve));
  await worker.request("/_next/static/chunks/missing.js");
  assert.equal(worker.network.length, 3, "a failed response is never cached");
});

test("activating a new version drops the previous cache", async () => {
  const worker = loadWorker();
  worker.stores.set("nkmz-v0", new Map([["https://app.test/old.js", "old"]]));
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  assert.equal(worker.stores.has("nkmz-v0"), false);
  assert.equal(worker.stores.size, 1);
});
