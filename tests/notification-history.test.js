import test from "node:test";
import assert from "node:assert/strict";

// notification-history-store.js は chrome.storage.local に依存しているため、
// Node実行環境用に最小限のインメモリ模擬実装を用意する。
function installFakeChromeStorage() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(obj) {
          Object.assign(store, obj);
        }
      }
    }
  };
  return store;
}

installFakeChromeStorage();

const { hasKey, addKeys, resetHistory, getHistorySize } = await import(
  "../src/storage/notification-history-store.js"
);
const { MAX_NOTIFICATION_HISTORY } = await import("../src/shared/constants.js");

test("追加したキーはhasKeyでtrueになる", async () => {
  await resetHistory();
  await addKeys(["key-a", "key-b"]);
  assert.equal(await hasKey("key-a"), true);
  assert.equal(await hasKey("key-b"), true);
  assert.equal(await hasKey("key-c"), false);
});

test("同じキーを重複して追加しても件数は増えない", async () => {
  await resetHistory();
  await addKeys(["key-a"]);
  await addKeys(["key-a"]);
  assert.equal(await getHistorySize(), 1);
});

test("上限を超えたら古いものから削除される", async () => {
  await resetHistory();
  const keys = Array.from({ length: MAX_NOTIFICATION_HISTORY + 10 }, (_, i) => `key-${i}`);
  await addKeys(keys);
  const size = await getHistorySize();
  assert.equal(size, MAX_NOTIFICATION_HISTORY);
  assert.equal(await hasKey("key-0"), false);
  assert.equal(await hasKey(`key-${MAX_NOTIFICATION_HISTORY + 9}`), true);
});

test("resetHistoryで履歴が空になる", async () => {
  await addKeys(["key-x"]);
  await resetHistory();
  assert.equal(await getHistorySize(), 0);
});
