import test from "node:test";
import assert from "node:assert/strict";

// service-worker.js はモジュール読み込み時に chrome.alarms / chrome.notifications /
// chrome.runtime の各 addListener を呼び出すため、インポート前に一通りのAPIを
// 模擬しておく必要がある。
const store = {};

let registeredMessageListener = null;
const notificationsCreateCalls = [];

function installFakeChrome({ throwOnSettingsGet } = {}) {
  notificationsCreateCalls.length = 0;
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          registeredMessageListener = listener;
        }
      },
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
      async create(id, options) {
        notificationsCreateCalls.push({ id, options });
      },
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

const MONITOR_URL = "https://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist";

function makeTopicConfig(partial) {
  return {
    id: partial.id,
    enabled: partial.enabled ?? true,
    name: partial.name ?? "",
    url: partial.url ?? `${MONITOR_URL}#cmd=forumalist&fid=${partial.forumId}&tid=${partial.topicId}`,
    forumId: partial.forumId ?? null,
    topicId: partial.topicId ?? null,
    firstCheckDone: partial.firstCheckDone ?? false
  };
}

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
  const config = makeTopicConfig({ id: "cfg-1", forumId: "8", topicId: "2319", firstCheckDone: false });
  const post = {
    topicName: "公用車キャンセル周知用",
    roomId: "8",
    topicId: "2319",
    author: "テスト太郎",
    postedAt: "2026-07-24",
    bodyPreview: "本文",
    url: "https://example.local/1"
  };

  const { newPostsByTopic, newCount, firstCheckDoneUpdatesById } = await classifyPosts(
    [config],
    [{ post, config }]
  );

  assert.equal(newCount, 0);
  assert.equal(newPostsByTopic.size, 0);
  assert.equal(firstCheckDoneUpdatesById["cfg-1"], true);
});

test("初回確認済みのトピックでは新規投稿だけが通知対象になる（forumId・topicIdで照合）", async () => {
  installFakeChrome({ throwOnSettingsGet: false });
  store.notificationHistory = { keys: ["id:8:2319:1"] };

  const config = makeTopicConfig({ id: "cfg-2", forumId: "8", topicId: "2319", firstCheckDone: true });
  const posts = [
    { topicName: "公用車キャンセル周知用", roomId: "8", topicId: "2319", postId: "1", author: "テスト太郎", postedAt: "2026-07-24", bodyPreview: "既知の投稿", url: "https://example.local/1" },
    { topicName: "公用車キャンセル周知用", roomId: "8", topicId: "2319", postId: "2", author: "テスト花子", postedAt: "2026-07-24", bodyPreview: "新しい投稿", url: "https://example.local/2" }
  ];

  const { newPostsByTopic, newCount } = await classifyPosts(
    [config],
    posts.map((post) => ({ post, config }))
  );

  assert.equal(newCount, 1);
  assert.equal(newPostsByTopic.get("公用車キャンセル周知用")[0].postId, "2");
});

test("名称が変わってもforumId・topicIdが同じなら既存の初回確認状態のまま新着を検知する", async () => {
  installFakeChrome({ throwOnSettingsGet: false });
  store.notificationHistory = { keys: [] };

  const config = makeTopicConfig({ id: "cfg-3", name: "新しい表示名", forumId: "8", topicId: "2319", firstCheckDone: true });
  const post = {
    topicName: "新しい表示名",
    roomId: "8",
    topicId: "2319",
    postId: "1",
    author: "テスト太郎",
    postedAt: "2026-07-24",
    bodyPreview: "投稿",
    url: "https://example.local/1"
  };

  const { newPostsByTopic, newCount } = await classifyPosts([config], [{ post, config }]);
  assert.equal(newCount, 1);
  assert.ok(newPostsByTopic.has("新しい表示名"));
});

test("トピックリンクを1件も認識できなかった場合、状態はOKのまま診断用エラーコードが記録される", async () => {
  installFakeChrome({ throwOnSettingsGet: false });
  store.settings = {
    monitorUrl: MONITOR_URL,
    topics: [makeTopicConfig({ id: "cfg-4", forumId: "8", topicId: "2319" })],
    desktopNotificationsEnabled: true,
    checkIntervalMinutes: 5,
    settingsVersion: 2
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
    monitorUrl: MONITOR_URL,
    topics: [makeTopicConfig({ id: "cfg-5", forumId: "8", topicId: "2319" })],
    desktopNotificationsEnabled: true,
    checkIntervalMinutes: 5,
    settingsVersion: 2
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

test("forumId・topicIdが一致する新着投稿があれば新規検知件数とバッジが更新される", async () => {
  installFakeChrome({ throwOnSettingsGet: false });
  store.notificationHistory = { keys: [] };
  store.settings = {
    monitorUrl: MONITOR_URL,
    topics: [makeTopicConfig({ id: "cfg-6", name: "公用車予約キャンセル周知用", forumId: "8", topicId: "2319", firstCheckDone: true })],
    desktopNotificationsEnabled: true,
    checkIntervalMinutes: 5,
    settingsVersion: 2
  };

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "<html><body></body></html>"
  });

  globalThis.chrome.runtime.sendMessage = async () => ({
    ok: true,
    pageState: "ok",
    posts: [
      {
        topicName: "公用車予約キャンセル周知用",
        roomId: "8",
        topicId: "2319",
        author: "テスト太郎",
        postedAt: "07/24 15:14",
        bodyPreview: "新しい投稿",
        url: `${MONITOR_URL}#cmd=forumalist&fid=8&tid=2319`
      }
    ],
    recognizedCount: 1,
    matchedCount: 1,
    parserMode: "desknets-v6",
    topicLinkCount: 1,
    rowCandidateCount: 1,
    topicNameFoundInHtml: true
  });

  const result = await runCheck();
  assert.equal(result.ok, true);

  const runtimeState = await getRuntimeState();
  assert.equal(runtimeState.debugInfo.newCount, 1);
  assert.ok(runtimeState.lastDetectedTopicNames.includes("公用車予約キャンセル周知用"));
});

test("send-test-notificationメッセージを処理し、chrome.notifications.create()を呼び出す", async () => {
  installFakeChrome({ throwOnSettingsGet: false });
  // service-worker.jsはモジュール読み込み時に一度だけonMessage.addListenerを呼ぶため、
  // ここで再インポートはできない。すでに登録済みのlistenerを直接呼び出して検証する。
  assert.ok(registeredMessageListener, "onMessage.addListenerが登録されていること");

  const response = await new Promise((resolve) => {
    const keepChannelOpen = registeredMessageListener({ type: "send-test-notification" }, {}, resolve);
    assert.equal(keepChannelOpen, true);
  });

  assert.equal(response.ok, true);
  assert.equal(notificationsCreateCalls.length, 1);
  assert.ok(notificationsCreateCalls[0].id.startsWith("desknets-noticer-test-"));
});
