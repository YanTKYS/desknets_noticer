// 実行時の状態（最終確認日時、前回結果、デバッグ情報など）の永続化。
// ポップアップ・設定画面・バックグラウンドの間で状態を共有するために使う。

import { STORAGE_KEYS, STATUS } from "../shared/constants.js";

/**
 * @typedef {Object} RuntimeState
 * @property {string} status STATUS定数のいずれか
 * @property {string|null} lastCheckedAt ISO日時文字列
 * @property {number} newCountSinceLastPopupOpen ポップアップ未確認の新規件数
 * @property {import("../shared/models.js").CheckDebugInfo|null} debugInfo
 * @property {boolean} isChecking 確認処理が実行中かどうか
 */

function defaultState() {
  return {
    status: STATUS.NOT_CONFIGURED,
    lastCheckedAt: null,
    newCountSinceLastPopupOpen: 0,
    debugInfo: null,
    isChecking: false
  };
}

/**
 * @returns {Promise<RuntimeState>}
 */
export async function getRuntimeState() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.RUNTIME_STATE);
  const existing = stored[STORAGE_KEYS.RUNTIME_STATE];
  if (!existing) return defaultState();
  return { ...defaultState(), ...existing };
}

/**
 * @param {Partial<RuntimeState>} partial
 * @returns {Promise<RuntimeState>}
 */
export async function updateRuntimeState(partial) {
  const current = await getRuntimeState();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ [STORAGE_KEYS.RUNTIME_STATE]: updated });
  return updated;
}

/**
 * ポップアップを開いたときにバッジと未確認件数をクリアする。
 */
export async function clearNewCountBadge() {
  await updateRuntimeState({ newCountSinceLastPopupOpen: 0 });
  await chrome.action.setBadgeText({ text: "" });
}
