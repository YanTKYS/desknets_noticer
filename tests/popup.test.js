import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const popupHtmlPath = path.join(__dirname, "..", "src", "popup", "popup.html");
const popupHtml = readFileSync(popupHtmlPath, "utf-8");

const dom = new JSDOM(popupHtml, { url: "https://example.invalid/popup.html" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

// popup.js から呼び出される chrome.runtime.sendMessage の挙動をテストごとに差し替えられるようにする。
let sendMessageImpl = async () => ({ ok: true });

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return { [key]: undefined };
      },
      async set() {}
    }
  },
  action: {
    setBadgeText: async () => {}
  },
  runtime: {
    sendMessage: (...args) => sendMessageImpl(...args),
    openOptionsPage: async () => {}
  },
  tabs: { query: async () => [] },
  windows: { update: async () => {} }
};

await import("../src/popup/popup.js");

function fireDomContentLoaded() {
  const event = new dom.window.Event("DOMContentLoaded", { bubbles: true, cancelable: true });
  document.dispatchEvent(event);
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

fireDomContentLoaded();
await flushMicrotasks();

test("「今すぐ確認」が成功した場合、完了後にボタンが再度有効になる", async () => {
  sendMessageImpl = async () => ({ ok: true });
  const button = document.getElementById("runNowButton");

  button.click();
  await flushMicrotasks();

  assert.equal(button.disabled, false);
  assert.equal(document.getElementById("popupError").hidden, true);
});

test("sendMessageが例外を投げても、ボタンは再度有効になりエラー表示される", async () => {
  sendMessageImpl = async () => {
    throw new Error("simulated messaging failure");
  };
  const button = document.getElementById("runNowButton");

  button.click();
  await flushMicrotasks();

  assert.equal(button.disabled, false);
  const errorEl = document.getElementById("popupError");
  assert.equal(errorEl.hidden, false);
  assert.equal(errorEl.textContent, "確認処理でエラーが発生しました。");
});

test("バックグラウンドがok:falseを返した場合もエラー表示される", async () => {
  sendMessageImpl = async () => ({ ok: false, errorCode: "UNEXPECTED_ERROR" });
  const button = document.getElementById("runNowButton");

  button.click();
  await flushMicrotasks();

  assert.equal(button.disabled, false);
  const errorEl = document.getElementById("popupError");
  assert.equal(errorEl.hidden, false);
});
