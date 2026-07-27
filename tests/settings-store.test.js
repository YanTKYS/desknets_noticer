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

const store = installFakeChromeStorage();

const {
  getSettings,
  saveSettings,
  validateTopicConfigsForSave,
  reconcileFirstCheckDoneOnSave,
  resetAllFirstCheckDone,
  getEnabledTopicConfigs,
  normalizeTopicName
} = await import("../src/storage/settings-store.js");
const { MAX_TOPIC_NAME_LENGTH, MAX_TOPICS, CURRENT_SETTINGS_VERSION } = await import("../src/shared/constants.js");

const MONITOR_URL = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on";
const TOPIC_URL_A = `${MONITOR_URL}#cmd=forumalist&fid=8&tid=2319&init=1`;
const TOPIC_URL_B = `${MONITOR_URL}#cmd=forumalist&fid=9&tid=4471&init=1`;

test("初期状態（旧設定なし）ではトピックが0件で、settingsVersionが最新である", async () => {
  const settings = await getSettings();
  assert.deepEqual(settings.topics, []);
  assert.equal(settings.settingsVersion, CURRENT_SETTINGS_VERSION);
});

test("トピック設定を保存すると読み込める", async () => {
  const validation = validateTopicConfigsForSave(
    [{ id: "t1", enabled: true, name: "公用車予約キャンセル周知用", url: TOPIC_URL_A }],
    MONITOR_URL
  );
  assert.equal(validation.ok, true);
  await saveSettings({ monitorUrl: MONITOR_URL, topics: validation.topics });

  const settings = await getSettings();
  assert.equal(settings.topics.length, 1);
  assert.equal(settings.topics[0].name, "公用車予約キャンセル周知用");
  assert.equal(settings.topics[0].forumId, "8");
  assert.equal(settings.topics[0].topicId, "2319");
});

test("前後空白が除去される", () => {
  assert.equal(normalizeTopicName("  公用車キャンセル周知用  "), "公用車キャンセル周知用");
});

test("連続空白は勝手に変更しない", () => {
  assert.equal(normalizeTopicName("  会議室　　キャンセル  "), "会議室　　キャンセル");
});

test("名称・URLとも空の行は保存対象から静かに除外される（追加直後の未入力カード）", () => {
  const validation = validateTopicConfigsForSave(
    [{ id: "t1", enabled: false, name: "", url: "" }],
    MONITOR_URL
  );
  assert.equal(validation.ok, true);
  assert.equal(validation.topics.length, 0);
});

test("通知ONでURLが空の場合は保存できない", () => {
  const validation = validateTopicConfigsForSave(
    [{ id: "t1", enabled: true, name: "テストトピック", url: "" }],
    MONITOR_URL
  );
  assert.equal(validation.ok, false);
  assert.ok(validation.fieldErrors[0][0].includes("トピックURL"));
});

test("名称のみでURLが空の通知OFF行は保存できる（移行直後を想定）", () => {
  const validation = validateTopicConfigsForSave(
    [{ id: "t1", enabled: false, name: "移行済みトピック", url: "" }],
    MONITOR_URL
  );
  assert.equal(validation.ok, true);
  assert.equal(validation.topics[0].name, "移行済みトピック");
  assert.equal(validation.topics[0].url, "");
  assert.equal(validation.topics[0].forumId, null);
});

test("cmd=forumalist以外のURLは拒否される", () => {
  const validation = validateTopicConfigsForSave(
    [{ id: "t1", enabled: true, name: "テスト", url: `${MONITOR_URL}#cmd=forumlist` }],
    MONITOR_URL
  );
  assert.equal(validation.ok, false);
});

test("fidが無いURLは拒否される", () => {
  const validation = validateTopicConfigsForSave(
    [{ id: "t1", enabled: true, name: "テスト", url: `${MONITOR_URL}#cmd=forumalist&tid=1` }],
    MONITOR_URL
  );
  assert.equal(validation.ok, false);
  assert.ok(validation.fieldErrors[0][0].includes("fid"));
});

test("tidが無いURLは拒否される", () => {
  const validation = validateTopicConfigsForSave(
    [{ id: "t1", enabled: true, name: "テスト", url: `${MONITOR_URL}#cmd=forumalist&fid=1` }],
    MONITOR_URL
  );
  assert.equal(validation.ok, false);
  assert.ok(validation.fieldErrors[0][0].includes("tid"));
});

test("新着情報画面と異なるオリジンのURLは拒否される", () => {
  const validation = validateTopicConfigsForSave(
    [{ id: "t1", enabled: true, name: "テスト", url: "http://evil.example.com/zforum.exe?cmd=forumlist#cmd=forumalist&fid=1&tid=1" }],
    MONITOR_URL
  );
  assert.equal(validation.ok, false);
  assert.ok(validation.fieldErrors[0][0].includes("異なるサーバー"));
});

test("100文字以内の名称を保存できる", () => {
  const name = "あ".repeat(100);
  const validation = validateTopicConfigsForSave([{ id: "t1", enabled: true, name, url: TOPIC_URL_A }], MONITOR_URL);
  assert.equal(validation.ok, true);
  assert.equal(validation.topics[0].name.length, 100);
});

test("100文字を超える名称は100文字に制限される", () => {
  const name = "あ".repeat(150);
  const validation = validateTopicConfigsForSave([{ id: "t1", enabled: true, name, url: TOPIC_URL_A }], MONITOR_URL);
  assert.equal(validation.topics[0].name.length, MAX_TOPIC_NAME_LENGTH);
});

test("同じforumId・topicIdの組み合わせは重複登録できない", () => {
  const validation = validateTopicConfigsForSave(
    [
      { id: "t1", enabled: true, name: "トピックA", url: TOPIC_URL_A },
      { id: "t2", enabled: false, name: "トピックA別名", url: TOPIC_URL_A }
    ],
    MONITOR_URL
  );
  assert.equal(validation.ok, false);
  assert.equal(validation.duplicateError, "同じ電子会議室トピックが複数登録されています。");
});

test("同じ名称でもforumId・topicIdが異なれば登録できる", () => {
  const validation = validateTopicConfigsForSave(
    [
      { id: "t1", enabled: true, name: "同じ名前", url: TOPIC_URL_A },
      { id: "t2", enabled: true, name: "同じ名前", url: TOPIC_URL_B }
    ],
    MONITOR_URL
  );
  assert.equal(validation.ok, true);
  assert.equal(validation.duplicateError, null);
});

test("登録件数が20件以内なら保存できる", () => {
  const rawTopics = Array.from({ length: MAX_TOPICS }, (_, i) => ({
    id: `t${i}`,
    enabled: false,
    name: `トピック${i}`,
    url: `${MONITOR_URL}#cmd=forumalist&fid=${i}&tid=${i}`
  }));
  const validation = validateTopicConfigsForSave(rawTopics, MONITOR_URL);
  assert.equal(validation.ok, true);
  assert.equal(validation.topics.length, MAX_TOPICS);
});

test("登録件数が21件になると保存できない", () => {
  const rawTopics = Array.from({ length: MAX_TOPICS + 1 }, (_, i) => ({
    id: `t${i}`,
    enabled: false,
    name: `トピック${i}`,
    url: `${MONITOR_URL}#cmd=forumalist&fid=${i}&tid=${i}`
  }));
  const validation = validateTopicConfigsForSave(rawTopics, MONITOR_URL);
  assert.equal(validation.ok, false);
  assert.equal(validation.countError, "通知対象は最大20件まで登録できます。");
});

test("getEnabledTopicConfigsは有効なトピックだけを返す", () => {
  const settings = {
    topics: [
      { id: "a", enabled: true, name: "A" },
      { id: "b", enabled: false, name: "B" }
    ]
  };
  const enabled = getEnabledTopicConfigs(settings);
  assert.equal(enabled.length, 1);
  assert.equal(enabled[0].id, "a");
});

test("新規追加トピックはfirstCheckDoneがfalseになる", () => {
  const previousTopics = [];
  const newTopics = [{ id: "new-1", forumId: "8", topicId: "2319", enabled: true, firstCheckDone: false }];
  const result = reconcileFirstCheckDoneOnSave(previousTopics, newTopics);
  assert.equal(result[0].firstCheckDone, false);
});

test("URL変更でforumId・topicIdが変わると初回確認待ちに戻る", () => {
  const previousTopics = [{ id: "t1", forumId: "8", topicId: "2319", enabled: true, firstCheckDone: true }];
  const newTopics = [{ id: "t1", forumId: "9", topicId: "4471", enabled: true, firstCheckDone: true }];
  const result = reconcileFirstCheckDoneOnSave(previousTopics, newTopics);
  assert.equal(result[0].firstCheckDone, false);
});

test("名称変更だけではforumId・topicIdが同じなら初回確認状態を維持する", () => {
  const previousTopics = [{ id: "t1", forumId: "8", topicId: "2319", name: "旧名称", enabled: true, firstCheckDone: true }];
  const newTopics = [{ id: "t1", forumId: "8", topicId: "2319", name: "新名称", enabled: true, firstCheckDone: true }];
  const result = reconcileFirstCheckDoneOnSave(previousTopics, newTopics);
  assert.equal(result[0].firstCheckDone, true);
});

test("OFFからONへの変更で初回確認状態がリセットされる", () => {
  const previousTopics = [{ id: "t1", forumId: "8", topicId: "2319", enabled: false, firstCheckDone: true }];
  const newTopics = [{ id: "t1", forumId: "8", topicId: "2319", enabled: true, firstCheckDone: true }];
  const result = reconcileFirstCheckDoneOnSave(previousTopics, newTopics);
  assert.equal(result[0].firstCheckDone, false);
});

test("変化が無いトピックはfirstCheckDoneを維持する", () => {
  const previousTopics = [{ id: "t1", forumId: "8", topicId: "2319", enabled: true, firstCheckDone: true }];
  const newTopics = [{ id: "t1", forumId: "8", topicId: "2319", enabled: true, firstCheckDone: true }];
  const result = reconcileFirstCheckDoneOnSave(previousTopics, newTopics);
  assert.equal(result[0].firstCheckDone, true);
});

test("resetAllFirstCheckDoneで全トピックのfirstCheckDoneがfalseになる", async () => {
  await saveSettings({
    topics: [
      { id: "t1", enabled: true, name: "A", url: TOPIC_URL_A, forumId: "8", topicId: "2319", firstCheckDone: true },
      { id: "t2", enabled: true, name: "B", url: TOPIC_URL_B, forumId: "9", topicId: "4471", firstCheckDone: true }
    ]
  });
  await resetAllFirstCheckDone();
  const settings = await getSettings();
  assert.ok(settings.topics.every((topic) => topic.firstCheckDone === false));
});

// --- 旧設定（v0.1.x固定2件方式）からの移行 -------------------------------------

test("旧固定2件設定を検出し、動的トピック設定へ移行する", async () => {
  delete store.settings;
  await chrome.storage.local.set({
    settings: {
      monitorUrl: MONITOR_URL,
      topics: [
        { name: "公用車予約キャンセル周知用", enabled: true },
        { name: "会議室予約キャンセル周知用", enabled: false }
      ],
      firstCheckDone: { 公用車予約キャンセル周知用: true }
    }
  });

  const settings = await getSettings();
  assert.equal(settings.topics.length, 2);
  assert.equal(settings.topics[0].name, "公用車予約キャンセル周知用");
  assert.equal(settings.topics[1].name, "会議室予約キャンセル周知用");
  assert.equal(settings.settingsVersion, CURRENT_SETTINGS_VERSION);
});

test("移行後のトピックには内部IDが付与される", async () => {
  const settings = await getSettings();
  settings.topics.forEach((topic) => {
    assert.equal(typeof topic.id, "string");
    assert.ok(topic.id.length > 0);
  });
});

test("移行直後はURL未設定のため、安全のため通知OFFへ変更される", async () => {
  const settings = await getSettings();
  assert.ok(settings.topics.every((topic) => topic.enabled === false));
  assert.ok(settings.topics.every((topic) => topic.url === ""));
  assert.ok(settings.topics.every((topic) => topic.migrationRequired === true));
});

test("移行処理は複数回getSettingsを呼んでもトピックを重複生成しない", async () => {
  const first = await getSettings();
  const second = await getSettings();
  assert.equal(first.topics.length, 2);
  assert.equal(second.topics.length, 2);
  assert.deepEqual(
    first.topics.map((t) => t.id),
    second.topics.map((t) => t.id)
  );
});

test("既存の通知履歴（旧トップレベルfirstCheckDoneマップ）は設定オブジェクトから除去される", async () => {
  const settings = await getSettings();
  assert.equal("firstCheckDone" in settings, false);
});
