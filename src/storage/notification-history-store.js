// 通知済み投稿の識別キー履歴を管理する。
// 投稿本文そのものではなく、識別キー（ハッシュ値または内部識別子）のみを保存する。

import { MAX_NOTIFICATION_HISTORY, STORAGE_KEYS } from "../shared/constants.js";

/**
 * @returns {Promise<{keys: string[]}>}
 */
async function loadHistory() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.NOTIFICATION_HISTORY);
  const history = stored[STORAGE_KEYS.NOTIFICATION_HISTORY];
  if (!history || !Array.isArray(history.keys)) {
    return { keys: [] };
  }
  return history;
}

/**
 * @param {{keys: string[]}} history
 */
async function saveHistory(history) {
  await chrome.storage.local.set({ [STORAGE_KEYS.NOTIFICATION_HISTORY]: history });
}

/**
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function hasKey(key) {
  const history = await loadHistory();
  return history.keys.includes(key);
}

/**
 * 複数の識別キーをまとめて既知として登録する。
 * 上限（MAX_NOTIFICATION_HISTORY）を超えた場合は古いものから削除する。
 * @param {string[]} keys
 */
export async function addKeys(keys) {
  if (!keys || keys.length === 0) return;
  const history = await loadHistory();
  const existingSet = new Set(history.keys);
  const newKeys = keys.filter((key) => !existingSet.has(key));
  if (newKeys.length === 0) return;

  const combined = [...history.keys, ...newKeys];
  const trimmed =
    combined.length > MAX_NOTIFICATION_HISTORY
      ? combined.slice(combined.length - MAX_NOTIFICATION_HISTORY)
      : combined;

  await saveHistory({ keys: trimmed });
}

/**
 * 通知済み履歴を全消去する（設定画面の「通知済み履歴をリセット」用）。
 */
export async function resetHistory() {
  await saveHistory({ keys: [] });
}

/**
 * @returns {Promise<number>}
 */
export async function getHistorySize() {
  const history = await loadHistory();
  return history.keys.length;
}
