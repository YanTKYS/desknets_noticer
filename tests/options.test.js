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
    sendMessage: async () => ({ ok: true })
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

test("「トピックを追加」で空のカードが追加される", async () => {
  document.getElementById("addTopicButton").click();
  await flushMicrotasks();

  const cards = document.querySelectorAll("#topicsContainer .topic-card");
  assert.equal(cards.length, 1);
  assert.equal(document.getElementById("noTopicsNotice").hidden, true);
});

test("トピック名とURLを入力し、保存すると設定に反映される", async () => {
  document.getElementById("monitorUrl").value = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist";
  dispatch(document.getElementById("monitorUrl"), "input");

  const card = document.querySelector("#topicsContainer .topic-card");
  const nameInput = card.querySelector('input[type="text"]');
  const urlInput = card.querySelector('input[type="url"]');
  const enabledCheckbox = card.querySelector('input[type="checkbox"]');

  nameInput.value = "公用車予約キャンセル周知用";
  dispatch(nameInput, "input");

  urlInput.value = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumalist&fid=8&tid=2319";
  dispatch(urlInput, "input");

  enabledCheckbox.checked = true;
  dispatch(enabledCheckbox, "change");
  await flushMicrotasks();

  document.getElementById("saveButton").click();
  await flushMicrotasks();

  assert.equal(document.getElementById("saveResult").textContent, "保存しました。");
  assert.equal(store.settings.topics.length, 1);
  assert.equal(store.settings.topics[0].name, "公用車予約キャンセル周知用");
  assert.equal(store.settings.topics[0].forumId, "8");
  assert.equal(store.settings.topics[0].topicId, "2319");
  assert.equal(store.settings.topics[0].enabled, true);
});

test("保存後に再読み込みしても入力内容が保持されている", async () => {
  const card = document.querySelector("#topicsContainer .topic-card");
  const nameInput = card.querySelector('input[type="text"]');
  assert.equal(nameInput.value, "公用車予約キャンセル周知用");

  const status = card.querySelector(".first-check-status");
  assert.equal(status.textContent, "初回確認: 待ち");
});

test("削除ボタンで確認ダイアログのあと通知対象を削除できる", async () => {
  document.querySelector("#topicsContainer .topic-delete-button").click();
  await flushMicrotasks();

  assert.equal(document.querySelectorAll("#topicsContainer .topic-card").length, 0);

  document.getElementById("saveButton").click();
  await flushMicrotasks();

  assert.equal(store.settings.topics.length, 0);
});
