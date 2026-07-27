import {
  getSettings,
  saveSettings,
  resetAllFirstCheckDone,
  validateTopicConfigsForSave,
  reconcileFirstCheckDoneOnSave
} from "../storage/settings-store.js";
import { getRuntimeState } from "../storage/runtime-state-store.js";
import * as historyStore from "../storage/notification-history-store.js";
import { validateAndNormalizeUrl, toOriginPermissionPattern, parseTopicUrl } from "../desknets/url-utils.js";
import { generateId } from "../shared/id-utils.js";
import {
  CHECK_INTERVAL_MINUTES_OPTIONS,
  DEFAULT_CHECK_INTERVAL_MINUTES,
  MAX_TOPICS
} from "../shared/constants.js";

/** @type {import("../shared/models.js").TopicConfig[]} 画面上で編集中のトピック一覧（保存前の作業コピー） */
let workingTopics = [];
/** @type {import("../shared/models.js").TopicConfig[]} 直近に保存された（読み込み時点の）トピック一覧 */
let previousTopics = [];

function findWorkingTopicIndex(id) {
  return workingTopics.findIndex((topic) => topic.id === id);
}

function clearGeneralTopicErrors() {
  document.getElementById("topicsDuplicateError").textContent = "";
  document.getElementById("topicsCountError").textContent = "";
}

function clearAllCardFieldErrors() {
  document.querySelectorAll("#topicsContainer .field-error").forEach((el) => {
    el.textContent = "";
  });
}

/**
 * 1件分のトピック設定カードのDOM要素を組み立てる。
 * 利用者が入力する値はすべて `.value` / `.textContent` で設定し、`innerHTML` は使用しない。
 * @param {import("../shared/models.js").TopicConfig} topic
 * @param {number} displayIndex 画面表示用の連番（1始まり）
 * @returns {HTMLElement}
 */
function buildTopicCard(topic, displayIndex) {
  const card = document.createElement("div");
  card.className = "topic-card";
  card.dataset.topicClientId = topic.id;

  const header = document.createElement("div");
  header.className = "topic-card-header";

  const heading = document.createElement("h3");
  heading.textContent = `通知対象${displayIndex}`;
  header.appendChild(heading);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "topic-delete-button";
  deleteButton.textContent = "削除";
  deleteButton.addEventListener("click", () => {
    const index = findWorkingTopicIndex(topic.id);
    if (index === -1) return;
    const current = workingTopics[index];
    const message = current.name
      ? `「${current.name}」を通知対象から削除しますか？`
      : "この通知対象を削除しますか？";
    if (!window.confirm(message)) return;
    workingTopics.splice(index, 1);
    renderTopicsContainer();
  });
  header.appendChild(deleteButton);

  card.appendChild(header);

  const enabledLabel = document.createElement("label");
  enabledLabel.className = "topic-enabled-label";
  const enabledCheckbox = document.createElement("input");
  enabledCheckbox.type = "checkbox";
  enabledCheckbox.checked = topic.enabled;
  enabledCheckbox.addEventListener("change", () => {
    const index = findWorkingTopicIndex(topic.id);
    if (index === -1) return;
    workingTopics[index] = { ...workingTopics[index], enabled: enabledCheckbox.checked };
    renderTopicsContainer();
  });
  enabledLabel.appendChild(enabledCheckbox);
  enabledLabel.appendChild(document.createTextNode(" 通知する"));
  card.appendChild(enabledLabel);

  const nameLabelId = `topicName-${topic.id}`;
  const nameLabel = document.createElement("label");
  nameLabel.setAttribute("for", nameLabelId);
  nameLabel.textContent = "トピック名";
  card.appendChild(nameLabel);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = nameLabelId;
  nameInput.maxLength = 100;
  nameInput.autocomplete = "off";
  nameInput.value = topic.name;
  nameInput.addEventListener("input", () => {
    const index = findWorkingTopicIndex(topic.id);
    if (index === -1) return;
    workingTopics[index] = { ...workingTopics[index], name: nameInput.value };
  });
  card.appendChild(nameInput);

  const urlLabelId = `topicUrl-${topic.id}`;
  const urlLabel = document.createElement("label");
  urlLabel.setAttribute("for", urlLabelId);
  urlLabel.textContent = "トピックURL";
  card.appendChild(urlLabel);

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.id = urlLabelId;
  urlInput.autocomplete = "off";
  urlInput.value = topic.url;
  card.appendChild(urlInput);

  const idsDisplay = document.createElement("p");
  idsDisplay.className = "topic-ids-display";

  function updateIdsDisplay(forumId, topicId) {
    idsDisplay.textContent = `会議室ID：${forumId ?? "-"}　トピックID：${topicId ?? "-"}`;
  }
  updateIdsDisplay(topic.forumId, topic.topicId);

  urlInput.addEventListener("input", () => {
    const index = findWorkingTopicIndex(topic.id);
    if (index === -1) return;

    const parsed = parseTopicUrl(urlInput.value);
    const forumId = parsed.ok ? parsed.forumId : null;
    const parsedTopicId = parsed.ok ? parsed.topicId : null;
    workingTopics[index] = {
      ...workingTopics[index],
      url: urlInput.value,
      forumId,
      topicId: parsedTopicId
    };
    updateIdsDisplay(forumId, parsedTopicId);
  });

  card.appendChild(idsDisplay);

  const firstCheckStatus = document.createElement("p");
  firstCheckStatus.className = "first-check-status";
  firstCheckStatus.textContent = topic.enabled ? (topic.firstCheckDone ? "初回確認: 完了" : "初回確認: 待ち") : "";
  card.appendChild(firstCheckStatus);

  if (topic.migrationRequired) {
    const migrationHint = document.createElement("p");
    migrationHint.className = "notice";
    migrationHint.textContent = "以前の設定から引き継ぎました。URLを入力して保存してください。";
    card.appendChild(migrationHint);
  }

  const fieldError = document.createElement("p");
  fieldError.className = "field-error";
  fieldError.setAttribute("role", "alert");
  card.appendChild(fieldError);

  return card;
}

function updateAddButtonState() {
  const addButton = document.getElementById("addTopicButton");
  const maxNotice = document.getElementById("maxTopicsNotice");
  const atMax = workingTopics.length >= MAX_TOPICS;
  addButton.disabled = atMax;
  maxNotice.hidden = !atMax;
}

function renderTopicsContainer() {
  const container = document.getElementById("topicsContainer");
  container.textContent = "";

  workingTopics.forEach((topic, index) => {
    container.appendChild(buildTopicCard(topic, index + 1));
  });

  document.getElementById("noTopicsNotice").hidden = workingTopics.length !== 0;
  const anyEnabled = workingTopics.some((topic) => topic.enabled);
  document.getElementById("allTopicsOffNotice").hidden = workingTopics.length === 0 || anyEnabled;

  updateAddButtonState();
}

function handleAddTopic() {
  if (workingTopics.length >= MAX_TOPICS) return;
  workingTopics.push({
    id: generateId(),
    enabled: false,
    name: "",
    url: "",
    forumId: null,
    topicId: null,
    firstCheckDone: false,
    migrationRequired: false
  });
  renderTopicsContainer();
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
  document.getElementById("debugTopicLinkCount").textContent = debugInfo?.topicLinkCount ?? "-";
  document.getElementById("debugRowCandidateCount").textContent = debugInfo?.rowCandidateCount ?? "-";
  document.getElementById("debugRecognizedCount").textContent = debugInfo?.recognizedCount ?? "-";
  document.getElementById("debugMatchedCount").textContent = debugInfo?.matchedCount ?? "-";
  document.getElementById("debugNewCount").textContent = debugInfo?.newCount ?? "-";
  document.getElementById("debugParserMode").textContent = debugInfo?.parserMode ?? "-";
  document.getElementById("debugTopicNameFoundInHtml").textContent =
    debugInfo?.topicNameFoundInHtml === null || debugInfo?.topicNameFoundInHtml === undefined
      ? "-"
      : debugInfo.topicNameFoundInHtml
        ? "あり"
        : "なし";
  document.getElementById("debugErrorCode").textContent = debugInfo?.errorCode ?? "-";
}

async function loadAndRender() {
  const settings = await getSettings();
  document.getElementById("monitorUrl").value = settings.monitorUrl;

  previousTopics = settings.topics;
  workingTopics = settings.topics.map((topic) => ({ ...topic }));
  document.getElementById("migrationNotice").hidden = !workingTopics.some((topic) => topic.migrationRequired);

  renderTopicsContainer();
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
  clearGeneralTopicErrors();
  clearAllCardFieldErrors();

  const rawUrl = document.getElementById("monitorUrl").value;
  const normalizedUrl = validateAndNormalizeUrl(rawUrl);

  if (rawUrl.trim() !== "" && !normalizedUrl) {
    saveResultEl.textContent = "URLの形式が正しくないため保存できませんでした。";
    return;
  }

  const validation = validateTopicConfigsForSave(workingTopics, normalizedUrl || "");

  if (!validation.ok) {
    const cards = document.querySelectorAll("#topicsContainer .topic-card");
    Object.entries(validation.fieldErrors).forEach(([index, messages]) => {
      const card = cards[Number(index)];
      const errorEl = card?.querySelector(".field-error");
      if (errorEl) errorEl.textContent = messages.join(" ");
    });
    if (validation.duplicateError) {
      document.getElementById("topicsDuplicateError").textContent = validation.duplicateError;
    }
    if (validation.countError) {
      document.getElementById("topicsCountError").textContent = validation.countError;
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

  const reconciledTopics = reconcileFirstCheckDoneOnSave(previousTopics, validation.topics);

  await saveSettings({
    monitorUrl: normalizedUrl || "",
    topics: reconciledTopics,
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

async function handleTestNotification() {
  const resultEl = document.getElementById("testNotificationResult");
  resultEl.textContent = "送信しています…";

  try {
    const response = await chrome.runtime.sendMessage({ type: "send-test-notification" });
    resultEl.textContent = response?.message || "テスト通知を作成できませんでした。";
  } catch (error) {
    console.error("[desknets_noticer] テスト通知の呼び出しに失敗しました。", error);
    resultEl.textContent = "テスト通知を作成できませんでした。";
  }
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
  document.getElementById("testNotificationButton").addEventListener("click", handleTestNotification);
  document.getElementById("addTopicButton").addEventListener("click", handleAddTopic);
  document.getElementById("saveButton").addEventListener("click", handleSave);
  document.getElementById("resetHistoryButton").addEventListener("click", handleResetHistory);
  document.getElementById("resetFirstCheckButton").addEventListener("click", handleResetFirstCheck);
});
