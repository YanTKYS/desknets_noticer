import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const optionsHtmlPath = path.join(__dirname, "..", "src", "options", "options.html");
const optionsHtml = readFileSync(optionsHtmlPath, "utf-8");

const dom = new JSDOM(optionsHtml, { url: "https://example.invalid/options.html" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.confirm = () => true;
dom.window.confirm = () => true;

const store = {};
const sentMessages = [];

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
  },
  permissions: {
    async contains() {
      return true;
    },
    async request() {
      return true;
    }
  },
  runtime: {
    sendMessage: async (message) => {
      sentMessages.push(message);
      return { ok: true };
    }
  }
};

await import("../src/options/options.js");

function fireDomContentLoaded() {
  const event = new dom.window.Event("DOMContentLoaded", { bubbles: true, cancelable: true });
  document.dispatchEvent(event);
}

async function flushMicrotasks() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function dispatch(el, type) {
  el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
}

fireDomContentLoaded();
await flushMicrotasks();

test("初期状態ではトピックが0件で、「登録されていません」の案内が表示される", () => {
  const cards = document.querySelectorAll("#topicsContainer .topic-card");
  assert.equal(cards.length, 0);
  assert.equal(document.getElementById("noTopicsNotice").hidden, false);
});

test("接続確認の右側に「接続先を保存」ボタンがある", () => {
  const testButton = document.getElementById("testConnectionButton");
  const saveButton = document.getElementById("saveConnectionButton");
  assert.ok(testButton);
  assert.ok(saveButton);
  assert.equal(saveButton.textContent, "接続先を保存");

  // DOM順序として接続確認の後に接続先を保存が続くことを確認する
  const row = testButton.parentElement;
  const children = Array.from(row.children);
  assert.ok(children.indexOf(testButton) < children.indexOf(saveButton));
});

test("画面下部に「すべての設定を保存」がある", () => {
  const button = document.getElementById("saveButton");
  assert.equal(button.textContent, "すべての設定を保存");
});

test("接続先URLを入力すると未保存表示になる", () => {
  const urlInput = document.getElementById("monitorUrl");
  urlInput.value = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist";
  dispatch(urlInput, "input");

  assert.equal(document.getElementById("connectionUnsavedBadge").hidden, false);
});

test("接続確認だけでは接続先は保存されない", async () => {
  document.getElementById("testConnectionButton").click();
  await flushMicrotasks();

  assert.equal(store.settings, undefined);
  assert.equal(document.getElementById("connectionUnsavedBadge").hidden, false);
});

test("「接続先を保存」でURLが保存され、未保存表示が消える", async () => {
  document.getElementById("saveConnectionButton").click();
  await flushMicrotasks();

  assert.equal(store.settings.monitorUrl, "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist");
  assert.equal(document.getElementById("connectionSaveResult").textContent, "接続先を保存しました。");
  assert.equal(document.getElementById("connectionUnsavedBadge").hidden, true);
});

test("保存済みURLと入力欄の値が同じ場合、接続確認は未保存扱いにしない", async () => {
  document.getElementById("testConnectionButton").click();
  await flushMicrotasks();
  assert.equal(document.getElementById("connectionUnsavedBadge").hidden, true);
});

test("「トピックを追加」で空のカードが追加され、保存ボタンが削除ボタンの左側にある", async () => {
  document.getElementById("addTopicButton").click();
  await flushMicrotasks();

  const cards = document.querySelectorAll("#topicsContainer .topic-card");
  assert.equal(cards.length, 1);
  assert.equal(document.getElementById("noTopicsNotice").hidden, true);

  const card = cards[0];
  const saveButton = card.querySelector(".topic-save-button");
  const deleteButton = card.querySelector(".topic-delete-button");
  assert.ok(saveButton);
  assert.ok(deleteButton);

  const actionsRow = saveButton.parentElement;
  const children = Array.from(actionsRow.children);
  assert.ok(children.indexOf(saveButton) < children.indexOf(deleteButton));
});

test("トピック名・URLを入力すると未保存表示になる", async () => {
  const card = document.querySelector("#topicsContainer .topic-card");
  const nameInput = card.querySelector('input[type="text"]');
  nameInput.value = "公用車予約キャンセル周知用";
  dispatch(nameInput, "input");

  assert.equal(card.querySelector(".unsaved-badge").hidden, false);
});

test("「このトピックを保存」で指定カードだけを保存できる", async () => {
  const card = document.querySelector("#topicsContainer .topic-card");
  const urlInput = card.querySelector('input[type="url"]');
  const enabledCheckbox = card.querySelector('input[type="checkbox"]');

  urlInput.value = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumalist&fid=8&tid=2319";
  dispatch(urlInput, "input");

  enabledCheckbox.checked = true;
  dispatch(enabledCheckbox, "change");
  await flushMicrotasks();

  const refreshedCard = document.querySelector("#topicsContainer .topic-card");
  refreshedCard.querySelector(".topic-save-button").click();
  await flushMicrotasks();

  assert.equal(refreshedCard.querySelector(".topic-save-result").textContent, "このトピックを保存しました。");
  assert.equal(store.settings.topics.length, 1);
  assert.equal(store.settings.topics[0].name, "公用車予約キャンセル周知用");
  assert.equal(store.settings.topics[0].forumId, "8");
  assert.equal(store.settings.topics[0].topicId, "2319");
  assert.equal(store.settings.topics[0].enabled, true);
  assert.equal(refreshedCard.querySelector(".unsaved-badge").hidden, true);
});

test("保存後に再読み込みしても入力内容が保持されている", async () => {
  const card = document.querySelector("#topicsContainer .topic-card");
  const nameInput = card.querySelector('input[type="text"]');
  assert.equal(nameInput.value, "公用車予約キャンセル周知用");

  const status = card.querySelector(".first-check-status");
  assert.equal(status.textContent, "初回確認: 待ち");
});

test("既存トピックを編集して個別保存できる（更新）", async () => {
  const card = document.querySelector("#topicsContainer .topic-card");
  const nameInput = card.querySelector('input[type="text"]');
  nameInput.value = "公用車予約取消連絡";
  dispatch(nameInput, "input");

  card.querySelector(".topic-save-button").click();
  await flushMicrotasks();

  assert.equal(store.settings.topics.length, 1);
  assert.equal(store.settings.topics[0].name, "公用車予約取消連絡");
  // firstCheckDoneはfid/tid変更が無いため維持される
  assert.equal(store.settings.topics[0].firstCheckDone, false);
});

test("他カードに未保存の変更があっても、個別保存では意図せず保存しない", async () => {
  document.getElementById("addTopicButton").click();
  await flushMicrotasks();

  const cards = document.querySelectorAll("#topicsContainer .topic-card");
  const secondCard = cards[1];
  const secondNameInput = secondCard.querySelector('input[type="text"]');
  secondNameInput.value = "まだ保存していないトピック";
  dispatch(secondNameInput, "input");

  const firstCard = cards[0];
  firstCard.querySelector(".topic-save-button").click();
  await flushMicrotasks();

  assert.equal(store.settings.topics.length, 1, "未保存の2件目は保存されない");
  assert.equal(firstCard.querySelector(".topic-save-result").textContent, "このトピックを保存しました。");
});

test("空のカードのまま個別保存しようとするとエラーになる", async () => {
  const cards = document.querySelectorAll("#topicsContainer .topic-card");
  const emptyCard = cards[1];
  const nameInput = emptyCard.querySelector('input[type="text"]');
  nameInput.value = "";
  dispatch(nameInput, "input");

  emptyCard.querySelector(".topic-save-button").click();
  await flushMicrotasks();

  assert.equal(store.settings.topics.length, 1);
  assert.match(emptyCard.querySelector(".field-error").textContent, /トピック名とトピックURLを入力/);
});

test("削除ボタンで確認ダイアログのあと通知対象を削除できる（保存前なのでストレージ操作は発生しない）", async () => {
  const cards = document.querySelectorAll("#topicsContainer .topic-card");
  assert.equal(cards.length, 2);
  cards[1].querySelector(".topic-delete-button").click();
  await flushMicrotasks();

  assert.equal(document.querySelectorAll("#topicsContainer .topic-card").length, 1);
  assert.equal(store.settings.topics.length, 1, "保存前の削除はストレージへ反映されない");
});

test("「すべての設定を保存」で全設定を一括保存できる", async () => {
  document.getElementById("addTopicButton").click();
  await flushMicrotasks();

  const cards = document.querySelectorAll("#topicsContainer .topic-card");
  const newCard = cards[1];
  newCard.querySelector('input[type="text"]').value = "会議室予約キャンセル周知用";
  dispatch(newCard.querySelector('input[type="text"]'), "input");
  newCard.querySelector('input[type="url"]').value =
    "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumalist&fid=9&tid=4471";
  dispatch(newCard.querySelector('input[type="url"]'), "input");

  document.getElementById("saveButton").click();
  await flushMicrotasks();

  assert.equal(document.getElementById("saveResult").textContent, "すべての設定を保存しました。");
  assert.equal(store.settings.topics.length, 2);
});

test("保存中は対象ボタンが無効化される", async () => {
  // saveConnectionSettings実行中に一瞬disabledになることを確認する
  // （chrome.runtime.sendMessageの解決を遅延させて検証する）。
  let resolveSendMessage;
  const originalSendMessage = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = (message) =>
    new Promise((resolve) => {
      resolveSendMessage = () => resolve(originalSendMessage(message));
    });

  const saveButton = document.getElementById("saveConnectionButton");
  saveButton.click();

  for (let i = 0; i < 20 && !resolveSendMessage; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(resolveSendMessage, "chrome.runtime.sendMessageが呼び出されていること");
  assert.equal(saveButton.disabled, true);

  resolveSendMessage();
  await flushMicrotasks();
  assert.equal(saveButton.disabled, false);

  chrome.runtime.sendMessage = originalSendMessage;
});
