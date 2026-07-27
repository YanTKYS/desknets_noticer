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
/** @type {Map<string, {enabled: boolean, name: string, url: string}>} カードごとの直近保存済みスナップショット（未保存表示の判定に使う） */
let savedTopicSnapshots = new Map();
/** @type {string} 直近保存済みの接続先URL（未保存表示の判定に使う） */
let savedMonitorUrl = "";

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
 * カードの現在値が、直近の保存済みスナップショットと異なるかどうかを判定する。
 * 新規追加（まだ一度も保存していない）カードは、名称・URLのどちらかに入力があれば
 * 未保存として扱う。
 * @param {import("../shared/models.js").TopicConfig} topic
 * @returns {boolean}
 */
function isTopicDirty(topic) {
  const saved = savedTopicSnapshots.get(topic.id);
  if (!saved) {
    return topic.name.trim() !== "" || topic.url.trim() !== "";
  }
  return saved.enabled !== topic.enabled || saved.name !== topic.name || saved.url !== topic.url;
}

function refreshCardUnsavedBadge(card, topic) {
  const badge = card.querySelector(".unsaved-badge");
  if (badge) badge.hidden = !isTopicDirty(topic);
}

function refreshConnectionUnsavedBadge() {
  const rawUrl = document.getElementById("monitorUrl").value;
  document.getElementById("connectionUnsavedBadge").hidden = rawUrl === savedMonitorUrl;
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

  const unsavedBadge = document.createElement("span");
  unsavedBadge.className = "unsaved-badge";
  unsavedBadge.textContent = "未保存の変更があります";
  unsavedBadge.hidden = !isTopicDirty(topic);
  header.appendChild(unsavedBadge);

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
    refreshCardUnsavedBadge(card, workingTopics[index]);
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
    refreshCardUnsavedBadge(card, workingTopics[index]);
  });

  card.appendChild(idsDisplay);

  const firstCheckStatus = document.createElement("p");
  firstCheckStatus.className = "first-check-status";
  firstCheckStatus.textContent = topic.enabled ? (topic.firstCheckDone ? "初回確認: 完了" : "初回確認: 待ち") : "";
  card.appendChild(firstCheckStatus);

  if (topic.migrationRequired) {
    const migrationHint = document.createElement("p");
    migrationHint.className = "notice migration-hint";
    migrationHint.textContent = "以前の設定から引き継ぎました。URLを入力して保存してください。";
    card.appendChild(migrationHint);
  }

  const fieldError = document.createElement("p");
  fieldError.className = "field-error";
  fieldError.setAttribute("role", "alert");
  card.appendChild(fieldError);

  const cardResult = document.createElement("p");
  cardResult.className = "topic-save-result";
  cardResult.setAttribute("role", "status");
  card.appendChild(cardResult);

  const cardActions = document.createElement("div");
  cardActions.className = "topic-card-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "topic-save-button";
  saveButton.textContent = "このトピックを保存";
  saveButton.addEventListener("click", () => saveTopicConfig(topic.id));
  cardActions.appendChild(saveButton);

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
    savedTopicSnapshots.delete(topic.id);
    renderTopicsContainer();
  });
  cardActions.appendChild(deleteButton);

  card.appendChild(cardActions);

  return card;
}

function updateAddButtonState() {
  const addButton = document.getElementById("addTopicButton");
  const maxNotice = document.getElementById("maxTopicsNotice");
  const atMax = workingTopics.length >= MAX_TOPICS;
  addButton.disabled = atMax;
  maxNotice.hidden = !atMax;
}

function refreshGlobalTopicNotices() {
  document.getElementById("noTopicsNotice").hidden = workingTopics.length !== 0;
  const anyEnabled = workingTopics.some((topic) => topic.enabled);
  document.getElementById("allTopicsOffNotice").hidden = workingTopics.length === 0 || anyEnabled;
  document.getElementById("migrationNotice").hidden = !workingTopics.some((topic) => topic.migrationRequired);
  updateAddButtonState();
}

function renderTopicsContainer() {
  const container = document.getElementById("topicsContainer");
  container.textContent = "";

  workingTopics.forEach((topic, index) => {
    container.appendChild(buildTopicCard(topic, index + 1));
  });

  refreshGlobalTopicNotices();
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
  savedMonitorUrl = settings.monitorUrl;
  document.getElementById("connectionUnsavedBadge").hidden = true;

  previousTopics = settings.topics;
  workingTopics = settings.topics.map((topic) => ({ ...topic }));
  savedTopicSnapshots = new Map(
    settings.topics.map((topic) => [topic.id, { enabled: topic.enabled, name: topic.name, url: topic.url }])
  );

  renderTopicsContainer();
  renderInterval(settings);
  renderNotificationOptions(settings);
  await renderDebugInfo();
  return settings;
}

async function withButtonsDisabled(buttons, statusEl, pendingText, task) {
  buttons.forEach((button) => {
    if (button) button.disabled = true;
  });
  if (statusEl) statusEl.textContent = pendingText;
  try {
    await task();
  } finally {
    buttons.forEach((button) => {
      if (button) button.disabled = false;
    });
  }
}

async function handleTestConnection() {
  const resultEl = document.getElementById("connectionResult");
  const testButton = document.getElementById("testConnectionButton");
  const rawUrl = document.getElementById("monitorUrl").value;
  const normalizedUrl = validateAndNormalizeUrl(rawUrl);

  if (!normalizedUrl) {
    resultEl.textContent = "URLの形式が正しくありません（http または https の完全なURLを入力してください）。";
    return;
  }

  await withButtonsDisabled([testButton], resultEl, "確認中…", async () => {
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

    const response = await chrome.runtime.sendMessage({ type: "test-connection", url: normalizedUrl });
    const baseMessage = response?.message || "確認結果を取得できませんでした。";

    if (!response?.ok) {
      resultEl.textContent = baseMessage;
      return;
    }

    const guidance =
      normalizedUrl === savedMonitorUrl
        ? "現在保存されている接続先です。"
        : "この接続先を使用するには「接続先を保存」を押してください。";
    resultEl.textContent = `${baseMessage} ${guidance}`;
  });
}

/**
 * 接続先（新着情報画面URL）だけを検証・保存する。通知対象トピックの
 * 未保存の編集内容は保存しない。
 */
async function saveConnectionSettings() {
  const saveButton = document.getElementById("saveConnectionButton");
  const resultEl = document.getElementById("connectionSaveResult");
  const rawUrl = document.getElementById("monitorUrl").value;

  await withButtonsDisabled([saveButton], resultEl, "保存中…", async () => {
    const normalizedUrl = validateAndNormalizeUrl(rawUrl);

    if (rawUrl.trim() !== "" && !normalizedUrl) {
      resultEl.textContent = "接続先を保存できませんでした。URLの形式が正しくありません。";
      return;
    }

    if (normalizedUrl) {
      const originPattern = toOriginPermissionPattern(normalizedUrl);
      if (originPattern) {
        const granted = await chrome.permissions.request({ origins: [originPattern] });
        if (!granted) {
          resultEl.textContent = "接続先を保存できませんでした。アクセス許可が得られませんでした。";
          return;
        }
      }
    }

    await saveSettings({ monitorUrl: normalizedUrl || "" });
    await chrome.runtime.sendMessage({ type: "settings-updated" });

    savedMonitorUrl = normalizedUrl || "";
    document.getElementById("monitorUrl").value = savedMonitorUrl;
    refreshConnectionUnsavedBadge();
    resultEl.textContent = "接続先を保存しました。";
  });
}

/**
 * 指定した1件のトピック設定だけを検証・保存する。他カードの未保存の編集内容は
 * 保存しない。重複判定は、他カードの未保存値ではなく保存済み設定と比較する。
 * @param {string} topicId
 */
async function saveTopicConfig(topicId) {
  const card = document.querySelector(`.topic-card[data-topic-client-id="${topicId}"]`);
  if (!card) return;

  const index = findWorkingTopicIndex(topicId);
  if (index === -1) return;

  const saveButton = card.querySelector(".topic-save-button");
  const deleteButton = card.querySelector(".topic-delete-button");
  const resultEl = card.querySelector(".topic-save-result");
  const errorEl = card.querySelector(".field-error");
  errorEl.textContent = "";

  await withButtonsDisabled([saveButton, deleteButton], resultEl, "保存中…", async () => {
    const target = workingTopics[index];

    if (target.name.trim() === "" && target.url.trim() === "") {
      errorEl.textContent = "トピック名とトピックURLを入力してください。";
      resultEl.textContent = "このトピックを保存できませんでした。";
      return;
    }

    const currentSettings = await getSettings();
    const otherTopics = currentSettings.topics.filter((topic) => topic.id !== topicId);
    const validation = validateTopicConfigsForSave([target, ...otherTopics], currentSettings.monitorUrl);

    if (!validation.ok) {
      const messages = [
        ...(validation.fieldErrors[0] || []),
        ...(validation.duplicateError ? [validation.duplicateError] : []),
        ...(validation.countError ? [validation.countError] : [])
      ];
      errorEl.textContent = messages.join(" ") || "入力内容を確認してください。";
      resultEl.textContent = "このトピックを保存できませんでした。";
      return;
    }

    if (currentSettings.monitorUrl) {
      const originPattern = toOriginPermissionPattern(currentSettings.monitorUrl);
      if (originPattern) {
        const granted = await chrome.permissions.request({ origins: [originPattern] });
        if (!granted) {
          errorEl.textContent = "接続先へのアクセス許可が得られませんでした。";
          resultEl.textContent = "このトピックを保存できませんでした。";
          return;
        }
      }
    }

    const reconciledTopics = reconcileFirstCheckDoneOnSave(currentSettings.topics, validation.topics);
    await saveSettings({ topics: reconciledTopics });
    await chrome.runtime.sendMessage({ type: "settings-updated" });

    previousTopics = reconciledTopics;
    const savedTopic = reconciledTopics.find((topic) => topic.id === topicId);
    if (savedTopic) {
      workingTopics[index] = { ...savedTopic };
      savedTopicSnapshots.set(topicId, {
        enabled: savedTopic.enabled,
        name: savedTopic.name,
        url: savedTopic.url
      });

      card.querySelector(".topic-ids-display").textContent =
        `会議室ID：${savedTopic.forumId ?? "-"}　トピックID：${savedTopic.topicId ?? "-"}`;
      card.querySelector(".first-check-status").textContent = savedTopic.enabled
        ? savedTopic.firstCheckDone
          ? "初回確認: 完了"
          : "初回確認: 待ち"
        : "";
      const migrationHint = card.querySelector(".migration-hint");
      if (migrationHint) migrationHint.remove();
      refreshCardUnsavedBadge(card, workingTopics[index]);
    }

    refreshGlobalTopicNotices();
    resultEl.textContent = "このトピックを保存しました。";
  });
}

/**
 * 画面内のすべての設定（接続先・全トピック・確認間隔・通知設定）を一括保存する。
 */
async function saveAllSettings() {
  const saveButton = document.getElementById("saveButton");
  const saveResultEl = document.getElementById("saveResult");

  await withButtonsDisabled([saveButton], saveResultEl, "保存中…", async () => {
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
      saveResultEl.textContent = "すべての設定を保存できませんでした。入力内容をご確認ください。";
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

    saveResultEl.textContent = "すべての設定を保存しました。";
    await loadAndRender();
  });
}

async function handleTestNotification() {
  const resultEl = document.getElementById("testNotificationResult");
  const testButton = document.getElementById("testNotificationButton");

  await withButtonsDisabled([testButton], resultEl, "送信しています…", async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "send-test-notification" });
      resultEl.textContent = response?.message || "テスト通知を作成できませんでした。";
    } catch (error) {
      console.error("[desknets_noticer] テスト通知の呼び出しに失敗しました。", error);
      resultEl.textContent = "テスト通知を作成できませんでした。";
    }
  });
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

  document.getElementById("monitorUrl").addEventListener("input", refreshConnectionUnsavedBadge);
  document.getElementById("testConnectionButton").addEventListener("click", handleTestConnection);
  document.getElementById("saveConnectionButton").addEventListener("click", saveConnectionSettings);
  document.getElementById("testNotificationButton").addEventListener("click", handleTestNotification);
  document.getElementById("addTopicButton").addEventListener("click", handleAddTopic);
  document.getElementById("saveButton").addEventListener("click", saveAllSettings);
  document.getElementById("resetHistoryButton").addEventListener("click", handleResetHistory);
  document.getElementById("resetFirstCheckButton").addEventListener("click", handleResetFirstCheck);
});
