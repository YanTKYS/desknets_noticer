// 設定情報の永続化。chrome.storage.local のみを使用し、Chrome同期は使わない。

import {
  DEFAULT_TOPICS,
  DEFAULT_CHECK_INTERVAL_MINUTES,
  MAX_TOPIC_NAME_LENGTH,
  STORAGE_KEYS
} from "../shared/constants.js";

/**
 * @typedef {Object} Settings
 * @property {string} monitorUrl desknet's NEOの新着情報画面URL（またはベースURL）
 * @property {number} checkIntervalMinutes 確認間隔（3, 5, 10のいずれか）
 * @property {{name: string, enabled: boolean}[]} topics 監視対象トピック
 * @property {boolean} desktopNotificationsEnabled デスクトップ通知の有効/無効
 * @property {boolean} showAuthorInBody 通知本文に投稿者名を表示するか
 * @property {boolean} showBodyPreviewInBody 通知本文に投稿冒頭を表示するか
 * @property {boolean} sessionExpiredNotifyEnabled ログイン切れの初回のみ通知するか
 * @property {Object.<string, boolean>} firstCheckDone トピックごとの初回確認完了フラグ
 */

/**
 * @returns {Settings}
 */
function defaultSettings() {
  return {
    monitorUrl: "",
    checkIntervalMinutes: DEFAULT_CHECK_INTERVAL_MINUTES,
    topics: DEFAULT_TOPICS.map((topic) => ({ ...topic })),
    desktopNotificationsEnabled: true,
    showAuthorInBody: true,
    showBodyPreviewInBody: true,
    sessionExpiredNotifyEnabled: false,
    firstCheckDone: {}
  };
}

/**
 * @returns {Promise<Settings>}
 */
export async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const defaults = defaultSettings();
  const existing = stored[STORAGE_KEYS.SETTINGS];
  if (!existing) return defaults;

  return {
    ...defaults,
    ...existing,
    topics: Array.isArray(existing.topics) && existing.topics.length > 0
      ? existing.topics
      : defaults.topics,
    firstCheckDone: existing.firstCheckDone || {}
  };
}

/**
 * @param {Partial<Settings>} partialSettings
 * @returns {Promise<Settings>}
 */
export async function saveSettings(partialSettings) {
  const current = await getSettings();
  const updated = { ...current, ...partialSettings };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated });
  return updated;
}

/**
 * 指定トピックの初回確認完了フラグをfalseに戻す（設定リセット用）。
 * @param {string} topicName
 */
export async function clearFirstCheckDone(topicName) {
  const current = await getSettings();
  const firstCheckDone = { ...current.firstCheckDone };
  delete firstCheckDone[topicName];
  await saveSettings({ firstCheckDone });
}

/**
 * すべてのトピックの初回確認完了フラグをリセットする。
 */
export async function resetAllFirstCheckDone() {
  await saveSettings({ firstCheckDone: {} });
}

/**
 * @param {Settings} settings
 * @returns {string[]}
 */
export function getEnabledTopicNames(settings) {
  return settings.topics.filter((topic) => topic.enabled).map((topic) => topic.name);
}

/**
 * トピック名を正規化する。前後の空白のみ除去し、大文字・小文字や全角・半角の変換、
 * 連続空白の変更は行わない。100文字を超える分は切り詰める。
 * @param {string} rawName
 * @returns {string}
 */
export function normalizeTopicName(rawName) {
  const trimmed = typeof rawName === "string" ? rawName.trim() : "";
  return trimmed.slice(0, MAX_TOPIC_NAME_LENGTH);
}

/**
 * 設定画面から入力されたトピック名・有効/無効の組を検証・正規化する。
 * - 通知ONなのに名称が空の場合はエラーとする
 * - 2件とも通知ONで名称が重複する場合はエラーとする
 * @param {{name: string, enabled: boolean}[]} rawTopics
 * @returns {{
 *   ok: boolean,
 *   topics: {name: string, enabled: boolean}[],
 *   fieldErrors: Object.<number, string>,
 *   duplicateError: string|null
 * }}
 */
export function validateTopicsForSave(rawTopics) {
  const normalized = rawTopics.map((topic) => ({
    name: normalizeTopicName(topic.name),
    enabled: !!topic.enabled
  }));

  const fieldErrors = {};
  normalized.forEach((topic, index) => {
    if (topic.enabled && topic.name === "") {
      fieldErrors[index] = "通知を有効にする場合は、トピック名を入力してください。";
    }
  });

  let duplicateError = null;
  const seenEnabledNames = new Set();
  for (const topic of normalized) {
    if (!topic.enabled || topic.name === "") continue;
    if (seenEnabledNames.has(topic.name)) {
      duplicateError = "同じトピック名を複数登録することはできません。";
      break;
    }
    seenEnabledNames.add(topic.name);
  }

  return {
    ok: Object.keys(fieldErrors).length === 0 && !duplicateError,
    topics: normalized,
    fieldErrors,
    duplicateError
  };
}

/**
 * トピック名の変更・OFF→ONへの変更があったスロットについて、初回確認完了フラグを
 * リセットする。名称が変わらず有効状態も変わらないスロットは、既存のフラグを維持する。
 * 現在のトピックに存在しない名称のフラグは、名称変更前の残骸として削除する。
 * @param {{name: string, enabled: boolean}[]} previousTopics 保存前のトピック（スロット順）
 * @param {{name: string, enabled: boolean}[]} newTopics 保存後のトピック（スロット順）
 * @param {Object.<string, boolean>} previousFirstCheckDone
 * @returns {Object.<string, boolean>}
 */
export function computeFirstCheckDoneAfterSave(previousTopics, newTopics, previousFirstCheckDone) {
  const validNames = new Set(newTopics.map((topic) => topic.name).filter((name) => name !== ""));

  const next = {};
  for (const [name, done] of Object.entries(previousFirstCheckDone || {})) {
    if (validNames.has(name)) {
      next[name] = done;
    }
  }

  newTopics.forEach((topic, index) => {
    if (topic.name === "") return;
    const previous = previousTopics[index];
    const nameChanged = !previous || previous.name !== topic.name;
    const turnedOn = !!previous && !previous.enabled && topic.enabled;
    if (nameChanged || turnedOn) {
      delete next[topic.name];
    }
  });

  return next;
}
