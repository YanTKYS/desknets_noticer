import test from "node:test";
import assert from "node:assert/strict";

// service-worker.js はモジュール読み込み時に chrome.alarms / chrome.notifications /
// chrome.runtime の各 addListener を呼び出すため、インポート前に一通りのAPIを
// 模擬しておく必要がある。
const store = {};

function installFakeChrome({ throwOnSettingsGet } = {}) {
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      sendMessage: async () => ({ ok: true, pageState: "ok", posts: [], recognizedCount: 0, matchedCount: 0, parserMode: "unknown" })
    },
    alarms: {
      onAlarm: { addListener() {} },
      get: async () => undefined,
      create: async () => {},
      clear: async () => {}
    },
    notifications: {
      onClicked: { addListener() {} },
      create: async () => {},
      clear: async () => {}
    },
    storage: {
      local: {
        async get(key) {
          if (throwOnSettingsGet && key === "settings") {
            throw new Error("simulated settings read failure");
          }
          return { [key]: store[key] };
        },
        async set(obj) {
          Object.assign(store, obj);
        }
      },
      session: {
        async get(key) {
          return { [key]: store[`session:${key}`] };
        },
        async set(obj) {
          for (const [key, value] of Object.entries(obj)) {
            store[`session:${key}`] = value;
          }
        }
      }
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {}
    },
    offscreen: {
      hasDocument: async () => false,
      createDocument: async () => {}
    },
    tabs: { query: async () => [] },
    windows: { update: async () => {} }
  };
}

installFakeChrome({ throwOnSettingsGet: true });

const { runCheck, classifyPosts } = await import("../src/background/service-worker.js");
const { getRuntimeState } = await import("../src/storage/runtime-state-store.js");
const { STATUS, ERROR_CODES } = await import("../src/shared/constants.js");

test("想定外の例外が発生しても runCheck は「確認中」のまま残らない", async () => {
  const result = await runCheck();
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, ERROR_CODES.UNEXPECTED_ERROR);

  const runtimeState = await getRuntimeState();
  assert.equal(runtimeState.status, STATUS.LAST_CHECK_ERROR);
});

test("例外後も排他フラグが解除され、再度 runCheck を呼び出せる", async () => {
  const result = await runCheck();
  // 「実行中のためスキップ」ではなく、通常どおり処理が試みられ失敗することを確認する
  // （前回の実行がisCheckInProgressに残ったままではないこと）。
  assert.equal(result.skipped, undefined);
  assert.equal(result.ok, false);
});

test("初回確認時にfirstCheckDoneを保存できる（既存投稿は通知されない）", async () => {
  installFakeChrome({ throwOnSettingsGet: false });

  const settings = { firstCheckDone: {} };
  const posts = [
    { topicName: "公用車キャンセル周知用", postId: "1", roomId: "r1", author: "テスト太郎", postedAt: "2026-07-24", bodyPreview: "本文", url: "https://example.local/1" }
  ];

  const { newPostsByTopic, newCount } = await classifyPosts(posts, settings, ["公用車キャンセル周知用"]);

  assert.equal(newCount, 0);
  assert.equal(newPostsByTopic.size, 0);

  const savedSettings = store.settings;
  assert.equal(savedSettings.firstCheckDone["公用車キャンセル周知用"], true);
});

test("初回確認済みのトピックでは新規投稿だけが通知対象になる", async () => {
  installFakeChrome({ throwOnSettingsGet: false });
  store.settings = { firstCheckDone: { 公用車キャンセル周知用: true } };
  store.notificationHistory = { keys: ["id:r1:公用車キャンセル周知用:1"] };

  const settings = { firstCheckDone: { 公用車キャンセル周知用: true } };
  const posts = [
    { topicName: "公用車キャンセル周知用", postId: "1", roomId: "r1", author: "テスト太郎", postedAt: "2026-07-24", bodyPreview: "既知の投稿", url: "https://example.local/1" },
    { topicName: "公用車キャンセル周知用", postId: "2", roomId: "r1", author: "テスト花子", postedAt: "2026-07-24", bodyPreview: "新しい投稿", url: "https://example.local/2" }
  ];

  const { newPostsByTopic, newCount } = await classifyPosts(posts, settings, ["公用車キャンセル周知用"]);

  assert.equal(newCount, 1);
  assert.equal(newPostsByTopic.get("公用車キャンセル周知用")[0].postId, "2");
});

test("トピックリンクを1件も認識できなかった場合、状態はOKのまま診断用エラーコードが記録される", async () => {
  installFakeChrome({ throwOnSettingsGet: false });
  store.settings = {
    monitorUrl: "https://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist",
    topics: [{ name: "公用車キャンセル周知用", enabled: true }],
    firstCheckDone: {},
    desktopNotificationsEnabled: true,
    checkIntervalMinutes: 5
  };

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "<html><body></body></html>"
  });

  // オフスクリーンドキュメントへのメッセージ送信（HTML解析）を模擬し、
  // トピックリンクを1件も検出できなかった結果を返す。
  globalThis.chrome.runtime.sendMessage = async () => ({
    ok: true,
    pageState: "ok",
    posts: [],
    recognizedCount: 0,
    matchedCount: 0,
    parserMode: "unknown",
    topicLinkCount: 0,
    rowCandidateCount: 0,
    topicNameFoundInHtml: false
  });

  const result = await runCheck();
  assert.equal(result.ok, true);

  const runtimeState = await getRuntimeState();
  assert.equal(runtimeState.status, STATUS.OK);
  assert.equal(runtimeState.debugInfo.errorCode, ERROR_CODES.NO_TOPIC_LINKS_FOUND);
  assert.equal(runtimeState.debugInfo.topicLinkCount, 0);
});

test("トピックリンクが認識できた場合は診断用エラーコードが記録されない", async () => {
  installFakeChrome({ throwOnSettingsGet: false });
  store.settings = {
    monitorUrl: "https://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist",
    topics: [{ name: "公用車キャンセル周知用", enabled: true }],
    firstCheckDone: {},
    desktopNotificationsEnabled: true,
    checkIntervalMinutes: 5
  };

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "<html><body></body></html>"
  });

  globalThis.chrome.runtime.sendMessage = async () => ({
    ok: true,
    pageState: "ok",
    posts: [],
    recognizedCount: 3,
    matchedCount: 0,
    parserMode: "desknets-v6",
    topicLinkCount: 3,
    rowCandidateCount: 3,
    topicNameFoundInHtml: false
  });

  const result = await runCheck();
  assert.equal(result.ok, true);

  const runtimeState = await getRuntimeState();
  assert.equal(runtimeState.status, STATUS.OK);
  assert.equal(runtimeState.debugInfo.errorCode, null);
});
