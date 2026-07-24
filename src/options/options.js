import { getSettings, saveSettings, resetAllFirstCheckDone } from "../storage/settings-store.js";
import { getRuntimeState } from "../storage/runtime-state-store.js";
import * as historyStore from "../storage/notification-history-store.js";
import { validateAndNormalizeUrl, toOriginPermissionPattern } from "../desknets/url-utils.js";
import { CHECK_INTERVAL_MINUTES_OPTIONS, DEFAULT_CHECK_INTERVAL_MINUTES } from "../shared/constants.js";

function renderTopics(settings) {
  const container = document.getElementById("topicsList");
  container.textContent = "";

  for (const topic of settings.topics) {
    const wrapper = document.createElement("label");
    wrapper.className = "topic-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = topic.enabled;
    checkbox.dataset.topicName = topic.name;
    checkbox.id = `topic-${topic.name}`;

    const textNode = document.createTextNode(topic.name);

    const statusSpan = document.createElement("span");
    statusSpan.className = "first-check-status";
    const isDone = settings.firstCheckDone?.[topic.name] === true;
    statusSpan.textContent = topic.enabled
      ? isDone
        ? "（初回確認 完了）"
        : "（初回確認待ち）"
      : "";

    wrapper.appendChild(checkbox);
    wrapper.appendChild(textNode);
    wrapper.appendChild(statusSpan);
    container.appendChild(wrapper);
  }

  const anyEnabled = settings.topics.some((topic) => topic.enabled);
  document.getElementById("allTopicsOffNotice").hidden = anyEnabled;
}

function readTopicsFromForm(previousTopics) {
  const checkboxes = document.querySelectorAll("#topicsList input[type=checkbox]");
  const enabledByName = new Map();
  checkboxes.forEach((checkbox) => {
    enabledByName.set(checkbox.dataset.topicName, checkbox.checked);
  });

  return previousTopics.map((topic) => ({
    name: topic.name,
    enabled: enabledByName.has(topic.name) ? enabledByName.get(topic.name) : topic.enabled
  }));
}

function renderInterval(settings) {
  const value = CHECK_INTERVAL_MINUTES_OPTIONS.includes(settings.checkIntervalMinutes)
    ? settings.checkIntervalMinutes
    : DEFAULT_CHECK_INTERVAL_MINUTES;
  const radio = document.querySelector(`input[name="checkIntervalMinutes"][value="${value}"]`);
  if (radio) radio.checked = true;
}

function readIntervalFromForm() {
  const checked = document.querySelector('input[name="checkIntervalMinutes"]:checked');
  return checked ? Number(checked.value) : DEFAULT_CHECK_INTERVAL_MINUTES;
}

function renderNotificationOptions(settings) {
  document.getElementById("desktopNotificationsEnabled").checked = settings.desktopNotificationsEnabled;
  document.getElementById("showAuthorInBody").checked = settings.showAuthorInBody;
  document.getElementById("showBodyPreviewInBody").checked = settings.showBodyPreviewInBody;
  document.getElementById("sessionExpiredNotifyEnabled").checked = settings.sessionExpiredNotifyEnabled;
}

async function renderDebugInfo() {
  const runtimeState = await getRuntimeState();
  const debugInfo = runtimeState.debugInfo;

  document.getElementById("debugLastCheckedAt").textContent = debugInfo?.lastCheckedAt
    ? new Date(debugInfo.lastCheckedAt).toLocaleString("ja-JP")
    : "-";
  document.getElementById("debugFetchResultType").textContent = debugInfo?.fetchResultType ?? "-";
  document.getElementById("debugRecognizedCount").textContent = debugInfo?.recognizedCount ?? "-";
  document.getElementById("debugMatchedCount").textContent = debugInfo?.matchedCount ?? "-";
  document.getElementById("debugNewCount").textContent = debugInfo?.newCount ?? "-";
  document.getElementById("debugParserMode").textContent = debugInfo?.parserMode ?? "-";
  document.getElementById("debugErrorCode").textContent = debugInfo?.errorCode ?? "-";
}

async function loadAndRender() {
  const settings = await getSettings();
  document.getElementById("monitorUrl").value = settings.monitorUrl;
  renderTopics(settings);
  renderInterval(settings);
  renderNotificationOptions(settings);
  await renderDebugInfo();
  return settings;
}

async function handleTestConnection() {
  const resultEl = document.getElementById("connectionResult");
  const rawUrl = document.getElementById("monitorUrl").value;
  const normalizedUrl = validateAndNormalizeUrl(rawUrl);

  if (!normalizedUrl) {
    resultEl.textContent = "URLの形式が正しくありません（http または https の完全なURLを入力してください）。";
    return;
  }

  const originPattern = toOriginPermissionPattern(normalizedUrl);
  if (originPattern) {
    const alreadyGranted = await chrome.permissions.contains({ origins: [originPattern] });
    if (!alreadyGranted) {
      resultEl.textContent = "アクセス許可を確認しています…";
      const granted = await chrome.permissions.request({ origins: [originPattern] });
      if (!granted) {
        resultEl.textContent = "接続先へのアクセス許可が得られなかったため、接続を確認できませんでした。";
        return;
      }
    }
  }

  resultEl.textContent = "確認中…";
  const response = await chrome.runtime.sendMessage({ type: "test-connection", url: normalizedUrl });
  resultEl.textContent = response?.message || "確認結果を取得できませんでした。";
}

async function handleSave() {
  const saveResultEl = document.getElementById("saveResult");
  const rawUrl = document.getElementById("monitorUrl").value;
  const normalizedUrl = validateAndNormalizeUrl(rawUrl);

  if (rawUrl.trim() !== "" && !normalizedUrl) {
    saveResultEl.textContent = "URLの形式が正しくないため保存できませんでした。";
    return;
  }

  if (normalizedUrl) {
    const originPattern = toOriginPermissionPattern(normalizedUrl);
    if (originPattern) {
      const granted = await chrome.permissions.request({ origins: [originPattern] });
      if (!granted) {
        saveResultEl.textContent = "接続先へのアクセス許可が得られなかったため保存できませんでした。";
        return;
      }
    }
  }

  const currentSettings = await getSettings();
  const updatedTopics = readTopicsFromForm(currentSettings.topics);

  await saveSettings({
    monitorUrl: normalizedUrl || "",
    topics: updatedTopics,
    checkIntervalMinutes: readIntervalFromForm(),
    desktopNotificationsEnabled: document.getElementById("desktopNotificationsEnabled").checked,
    showAuthorInBody: document.getElementById("showAuthorInBody").checked,
    showBodyPreviewInBody: document.getElementById("showBodyPreviewInBody").checked,
    sessionExpiredNotifyEnabled: document.getElementById("sessionExpiredNotifyEnabled").checked
  });

  await chrome.runtime.sendMessage({ type: "settings-updated" });

  saveResultEl.textContent = "保存しました。";
  await loadAndRender();
}

async function handleResetHistory() {
  const resultEl = document.getElementById("resetResult");
  const confirmed = window.confirm(
    "通知済み履歴をリセットします。よろしいですか？（リセット後は次回確認時に新しい基準値を作成します）"
  );
  if (!confirmed) return;

  await historyStore.resetHistory();
  resultEl.textContent = "通知済み履歴をリセットしました。";
}

async function handleResetFirstCheck() {
  const resultEl = document.getElementById("resetResult");
  const confirmed = window.confirm(
    "初回確認状態に戻します。よろしいですか？（次回確認時点の投稿を新しい基準値とし、それ以前の投稿は通知しません）"
  );
  if (!confirmed) return;

  await resetAllFirstCheckDone();
  resultEl.textContent = "初回確認状態に戻しました。";
  await loadAndRender();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadAndRender();

  document.getElementById("testConnectionButton").addEventListener("click", handleTestConnection);
  document.getElementById("saveButton").addEventListener("click", handleSave);
  document.getElementById("resetHistoryButton").addEventListener("click", handleResetHistory);
  document.getElementById("resetFirstCheckButton").addEventListener("click", handleResetFirstCheck);
});
