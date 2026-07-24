// chrome.alarms を使った定期確認のスケジューリング。

import { ALARM_NAME, CHECK_INTERVAL_MINUTES_OPTIONS, DEFAULT_CHECK_INTERVAL_MINUTES } from "../shared/constants.js";

/**
 * 確認間隔（分）を検証し、許可されている値以外はデフォルトへフォールバックする。
 * @param {number} minutes
 * @returns {number}
 */
export function normalizeIntervalMinutes(minutes) {
  return CHECK_INTERVAL_MINUTES_OPTIONS.includes(minutes) ? minutes : DEFAULT_CHECK_INTERVAL_MINUTES;
}

/**
 * 指定した間隔でアラームを（再）設定する。
 * @param {number} intervalMinutes
 */
export async function ensureAlarm(intervalMinutes) {
  const periodInMinutes = normalizeIntervalMinutes(intervalMinutes);
  const existing = await chrome.alarms.get(ALARM_NAME);

  if (existing && existing.periodInMinutes === periodInMinutes) {
    return;
  }

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes, delayInMinutes: periodInMinutes });
}
