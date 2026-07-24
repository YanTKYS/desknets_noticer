import test from "node:test";
import assert from "node:assert/strict";

// settings-store.js は chrome.storage.local に依存しているため、
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

const {
  getSettings,
  saveSettings,
  validateTopicsForSave,
  computeFirstCheckDoneAfterSave,
  normalizeTopicName
} = await import("../src/storage/settings-store.js");
const { MAX_TOPIC_NAME_LENGTH } = await import("../src/shared/constants.js");

test("初期値として2つのトピック名が設定される", async () => {
  const settings = await getSettings();
  assert.equal(settings.topics.length, 2);
  assert.equal(settings.topics[0].name, "公用車キャンセル周知用");
  assert.equal(settings.topics[1].name, "会議室キャンセル周知用");
  assert.equal(settings.topics[0].enabled, false);
  assert.equal(settings.topics[1].enabled, false);
});

test("旧設定が存在しない場合に初期値が補完される", async () => {
  const settings = await getSettings();
  assert.ok(Array.isArray(settings.topics));
  assert.equal(settings.topics.length, 2);
});

test("旧設定が存在する場合に名称と有効状態が維持される", async () => {
  await saveSettings({
    topics: [
      { name: "既存トピックA", enabled: true },
      { name: "既存トピックB", enabled: false }
    ]
  });
  const settings = await getSettings();
  assert.equal(settings.topics[0].name, "既存トピックA");
  assert.equal(settings.topics[0].enabled, true);
  assert.equal(settings.topics[1].name, "既存トピックB");
  assert.equal(settings.topics[1].enabled, false);
});

test("トピック名を変更して保存できる", async () => {
  const validation = validateTopicsForSave([
    { name: "公用車予約取消連絡", enabled: true },
    { name: "会議室キャンセル周知用", enabled: false }
  ]);
  assert.equal(validation.ok, true);
  await saveSettings({ topics: validation.topics });
  const settings = await getSettings();
  assert.equal(settings.topics[0].name, "公用車予約取消連絡");
});

test("前後空白が除去される", () => {
  assert.equal(normalizeTopicName("  公用車キャンセル周知用  "), "公用車キャンセル周知用");
});

test("連続空白は勝手に変更しない", () => {
  assert.equal(normalizeTopicName("  会議室　　キャンセル  "), "会議室　　キャンセル");
});

test("通知ONで空文字の場合は保存できない", () => {
  const validation = validateTopicsForSave([
    { name: "   ", enabled: true },
    { name: "会議室キャンセル周知用", enabled: false }
  ]);
  assert.equal(validation.ok, false);
  assert.equal(validation.fieldErrors[0], "通知を有効にする場合は、トピック名を入力してください。");
});

test("通知OFFで空文字の場合は保存できる", () => {
  const validation = validateTopicsForSave([
    { name: "", enabled: false },
    { name: "会議室キャンセル周知用", enabled: true }
  ]);
  assert.equal(validation.ok, true);
});

test("同じ名称を2件ともONにした場合は保存できない", () => {
  const validation = validateTopicsForSave([
    { name: "同じ名前", enabled: true },
    { name: "同じ名前", enabled: true }
  ]);
  assert.equal(validation.ok, false);
  assert.equal(validation.duplicateError, "同じトピック名を複数登録することはできません。");
});

test("同じ名称でも片方がOFFなら保存できる", () => {
  const validation = validateTopicsForSave([
    { name: "同じ名前", enabled: true },
    { name: "同じ名前", enabled: false }
  ]);
  assert.equal(validation.ok, true);
});

test("100文字以内の名称を保存できる", () => {
  const name = "あ".repeat(100);
  const validation = validateTopicsForSave([
    { name, enabled: true },
    { name: "", enabled: false }
  ]);
  assert.equal(validation.ok, true);
  assert.equal(validation.topics[0].name.length, 100);
});

test("100文字を超える名称は100文字に制限される", () => {
  const name = "あ".repeat(150);
  const validation = validateTopicsForSave([
    { name, enabled: true },
    { name: "", enabled: false }
  ]);
  assert.equal(validation.topics[0].name.length, MAX_TOPIC_NAME_LENGTH);
});

test("名称変更後はfirstCheckDoneが未完了になる（キーが削除される）", () => {
  const previousTopics = [
    { name: "公用車キャンセル周知用", enabled: true },
    { name: "会議室キャンセル周知用", enabled: false }
  ];
  const newTopics = [
    { name: "公用車予約取消連絡", enabled: true },
    { name: "会議室キャンセル周知用", enabled: false }
  ];
  const previousFirstCheckDone = { 公用車キャンセル周知用: true };

  const result = computeFirstCheckDoneAfterSave(previousTopics, newTopics, previousFirstCheckDone);
  assert.equal(result["公用車予約取消連絡"], undefined);
  assert.equal(result["公用車キャンセル周知用"], undefined);
});

test("名称未変更のトピックは既存の初回確認状態を維持する", () => {
  const previousTopics = [
    { name: "公用車キャンセル周知用", enabled: true },
    { name: "会議室キャンセル周知用", enabled: true }
  ];
  const newTopics = [
    { name: "公用車キャンセル周知用", enabled: true },
    { name: "会議室キャンセル周知用", enabled: true }
  ];
  const previousFirstCheckDone = {
    公用車キャンセル周知用: true,
    会議室キャンセル周知用: true
  };

  const result = computeFirstCheckDoneAfterSave(previousTopics, newTopics, previousFirstCheckDone);
  assert.equal(result["公用車キャンセル周知用"], true);
  assert.equal(result["会議室キャンセル周知用"], true);
});

test("OFFからONにした場合も初回確認状態がリセットされる", () => {
  const previousTopics = [
    { name: "公用車キャンセル周知用", enabled: false },
    { name: "会議室キャンセル周知用", enabled: true }
  ];
  const newTopics = [
    { name: "公用車キャンセル周知用", enabled: true },
    { name: "会議室キャンセル周知用", enabled: true }
  ];
  // OFFの間にも過去にtrueだったことがある想定（再ONで再度リセットされるべき）
  const previousFirstCheckDone = {
    公用車キャンセル周知用: true,
    会議室キャンセル周知用: true
  };

  const result = computeFirstCheckDoneAfterSave(previousTopics, newTopics, previousFirstCheckDone);
  assert.equal(result["公用車キャンセル周知用"], undefined);
  assert.equal(result["会議室キャンセル周知用"], true);
});

test("現在のトピックに存在しない名称のfirstCheckDoneキーは削除される", () => {
  const previousTopics = [
    { name: "公用車キャンセル周知用", enabled: true },
    { name: "会議室キャンセル周知用", enabled: true }
  ];
  const newTopics = [
    { name: "公用車キャンセル周知用", enabled: true },
    { name: "会議室キャンセル周知用", enabled: true }
  ];
  const previousFirstCheckDone = {
    公用車キャンセル周知用: true,
    会議室キャンセル周知用: true,
    過去に使っていたトピック名: true
  };

  const result = computeFirstCheckDoneAfterSave(previousTopics, newTopics, previousFirstCheckDone);
  assert.equal("過去に使っていたトピック名" in result, false);
});
