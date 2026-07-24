import test from "node:test";
import assert from "node:assert/strict";

const sessionStore = {};
const calls = { tabsUpdate: [], tabsCreate: [], windowsUpdate: [] };

function installFakeChrome(tabs) {
  calls.tabsUpdate.length = 0;
  calls.tabsCreate.length = 0;
  calls.windowsUpdate.length = 0;

  globalThis.chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: sessionStore[key] };
        },
        async set(obj) {
          Object.assign(sessionStore, obj);
        }
      }
    },
    notifications: {
      async create() {},
      async clear() {}
    },
    tabs: {
      async query() {
        return tabs;
      },
      async update(tabId, updateInfo) {
        calls.tabsUpdate.push({ tabId, updateInfo });
      },
      async create(createInfo) {
        calls.tabsCreate.push(createInfo);
      }
    },
    windows: {
      async update(windowId, updateInfo) {
        calls.windowsUpdate.push({ windowId, updateInfo });
      }
    }
  };
}

const { handleNotificationClick, notifyNewPosts } = await import("../src/background/notification-manager.js");

test("通知クリック時、設定URLと完全一致するタブを新着情報画面URLへ遷移させる", async () => {
  const targetUrl = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumalist&fid=8&tid=2319";
  installFakeChrome([{ id: 42, url: targetUrl, windowId: 7 }]);
  sessionStore.notificationUrlMap = { "notif-1": targetUrl };

  await handleNotificationClick("notif-1", "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist");

  assert.equal(calls.tabsUpdate.length, 1);
  assert.equal(calls.tabsUpdate[0].tabId, 42);
  assert.equal(calls.tabsUpdate[0].updateInfo.url, targetUrl);
  assert.equal(calls.tabsUpdate[0].updateInfo.active, true);
  assert.equal(calls.windowsUpdate.length, 1);
  assert.equal(calls.tabsCreate.length, 0);
});

test("同一オリジンの別画面タブしかない場合も、そのタブを対象URLへ遷移させる（前面表示だけで終わらせない）", async () => {
  const targetUrl = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumalist&fid=8&tid=2319";
  installFakeChrome([{ id: 5, url: "http://groupware.example.local/portal/top.html", windowId: 1 }]);
  sessionStore.notificationUrlMap = { "notif-2": targetUrl };

  await handleNotificationClick("notif-2", "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist");

  assert.equal(calls.tabsUpdate.length, 1);
  assert.equal(calls.tabsUpdate[0].tabId, 5);
  assert.equal(calls.tabsUpdate[0].updateInfo.url, targetUrl);
});

test("該当タブが無い場合は新規タブを開く", async () => {
  const targetUrl = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumalist&fid=8&tid=2319";
  installFakeChrome([]);
  sessionStore.notificationUrlMap = { "notif-3": targetUrl };

  await handleNotificationClick("notif-3", "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist");

  assert.equal(calls.tabsCreate.length, 1);
  assert.equal(calls.tabsCreate[0].url, targetUrl);
  assert.equal(calls.tabsUpdate.length, 0);
});

test("異なるオリジンのURLは同一オリジン検証により開かない", async () => {
  const maliciousUrl = "http://evil.example.com/phishing";
  installFakeChrome([{ id: 1, url: "http://groupware.example.local/portal/top.html" }]);
  sessionStore.notificationUrlMap = { "notif-4": maliciousUrl };

  await handleNotificationClick("notif-4", "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist");

  assert.equal(calls.tabsCreate.length, 0);
  assert.equal(calls.tabsUpdate.length, 0);
});

test("notifyNewPostsは投稿本文や職員名をそのまま長期保存しない（通知作成のみ行う）", async () => {
  installFakeChrome([]);
  const postsByTopic = new Map([
    [
      "公用車キャンセル周知用",
      [
        {
          topicName: "公用車キャンセル周知用",
          author: "テスト太郎",
          postedAt: "07/24 15:14",
          bodyPreview: "テスト本文",
          url: "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumalist&fid=8&tid=1"
        }
      ]
    ]
  ]);

  await notifyNewPosts(postsByTopic, { showAuthorInBody: true, showBodyPreviewInBody: true }, "http://groupware.example.local/");

  // notification-managerが状態を持つのはchrome.storage.sessionの通知ID→URLマップのみで、
  // 投稿本文や職員名そのものは保存されない。
  const storedValues = Object.values(sessionStore.notificationUrlMap || {});
  for (const value of storedValues) {
    assert.equal(typeof value, "string");
    assert.ok(!value.includes("テスト太郎"));
    assert.ok(!value.includes("テスト本文"));
  }
});
