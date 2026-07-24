import {
  getSettings,
  saveSettings,
  resetAllFirstCheckDone,
  validateTopicsForSave,
  computeFirstCheckDoneAfterSave
} from "../storage/settings-store.js";
import { getRuntimeState } from "../storage/runtime-state-store.js";
import * as historyStore from "../storage/notification-history-store.js";
import { validateAndNormalizeUrl, toOriginPermissionPattern } from "../desknets/url-utils.js";
import {
  CHECK_INTERVAL_MINUTES_OPTIONS,
  DEFAULT_CHECK_INTERVAL_MINUTES,
  DEFAULT_TOPICS
} from "../shared/constants.js";

const TOPIC_SLOT_COUNT = 2;

/**
 * 設定に保存されているトピックを、常に2つのスロット（通知対象1・2）として取り出す。
 * 保存件数が2件に満たない旧設定でも、初期値で補完する。
 * @param {import("../storage/settings-store.js").Settings} settings
 * @returns {{name: string, enabled: boolean}[]}
 */
function getTopicsForSlots(settings) {
  return Array.from({ length: TOPIC_SLOT_COUNT }, (_, index) => {
    const existing = settings.topics[index];
    if (existing) return { name: existing.name, enabled: existing.enabled };
    const fallback = DEFAULT_TOPICS[index];
    return fallback ? { name: fallback.name, enabled: fallback.enabled } : { name: "", enabled: false };
  });
}

function clearTopicErrors() {
  for (let index = 0; index < TOPIC_SLOT_COUNT; index += 1) {
    document.getElementById(`topicNameError${index}`).textContent = "";
  }
  document.getElementById("topicsDuplicateError").textContent = "";
}

function renderTopics(settings) {
  const topics = getTopicsForSlots(settings);

  topics.forEach((topic, index) => {
    document.getElementById(`topicEnabled${index}`).checked = topic.enabled;
    document.getElementById(`topicName${index}`).value = topic.name;

    const isDone = settings.firstCheckDone?.[topic.name] === true;
    const statusEl = document.getElementById(`topicFirstCheckStatus${index}`);
    statusEl.textContent = topic.enabled ? (isDone ? "初回確認: 完了" : "初回確認: 待ち") : "";
  });

  clearTopicErrors();

  const anyEnabled = topics.some((topic) => topic.enabled);
  document.getElementById("allTopicsOffNotice").hidden = anyEnabled;
}

/**
 * フォームから入力値をそのまま（未検証・未正規化）読み取る。
 * @returns {{name: string, enabled: boolean}[]}
 */
function readTopicsFromFormRaw() {
  return Array.from({ length: TOPIC_SLOT_COUNT }, (_, index) => ({
    name: document.getElementById(`topicName${index}`).value,
    enabled: document.getElementById(`topicEnabled${index}`).checked
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
  saveResultEl.textContent = "";
  clearTopicErrors();

  const rawUrl = document.getElementById("monitorUrl").value;
  const normalizedUrl = validateAndNormalizeUrl(rawUrl);

  if (rawUrl.trim() !== "" && !normalizedUrl) {
    saveResultEl.textContent = "URLの形式が正しくないため保存できませんでした。";
    return;
  }

  const currentSettings = await getSettings();
  const previousTopics = getTopicsForSlots(currentSettings);
  const rawTopics = readTopicsFromFormRaw();
  const validation = validateTopicsForSave(rawTopics);

  if (!validation.ok) {
    Object.entries(validation.fieldErrors).forEach(([index, message]) => {
      document.getElementById(`topicNameError${index}`).textContent = message;
    });
    if (validation.duplicateError) {
      document.getElementById("topicsDuplicateError").textContent = validation.duplicateError;
    }
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

  const updatedTopics = validation.topics;
  const updatedFirstCheckDone = computeFirstCheckDoneAfterSave(
    previousTopics,
    updatedTopics,
    currentSettings.firstCheckDone
  );

  await saveSettings({
    monitorUrl: normalizedUrl || "",
    topics: updatedTopics,
    firstCheckDone: updatedFirstCheckDone,
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
