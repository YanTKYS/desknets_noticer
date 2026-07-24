// 設定情報の永続化。chrome.storage.local のみを使用し、Chrome同期は使わない。

import {
  DEFAULT_TOPICS,
  DEFAULT_CHECK_INTERVAL_MINUTES,
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
