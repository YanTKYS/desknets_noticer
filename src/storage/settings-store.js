// 設定情報の永続化。chrome.storage.local のみを使用し、Chrome同期は使わない。

import {
  DEFAULT_CHECK_INTERVAL_MINUTES,
  MAX_TOPIC_NAME_LENGTH,
  MAX_TOPICS,
  CURRENT_SETTINGS_VERSION,
  STORAGE_KEYS
} from "../shared/constants.js";
import { createTopicConfig } from "../shared/models.js";
import { generateId } from "../shared/id-utils.js";
import { validateAndNormalizeUrl, isSameOrigin, parseTopicUrl } from "../desknets/url-utils.js";

/**
 * @typedef {import("../shared/models.js").TopicConfig} TopicConfig
 */

/**
 * @typedef {Object} Settings
 * @property {string} monitorUrl desknet's NEOの新着情報画面URL
 * @property {number} checkIntervalMinutes 確認間隔（3, 5, 10のいずれか）
 * @property {TopicConfig[]} topics 通知対象トピック（利用者が追加・削除・編集する動的な配列）
 * @property {boolean} desktopNotificationsEnabled デスクトップ通知の有効/無効
 * @property {boolean} showAuthorInBody 通知本文に投稿者名を表示するか
 * @property {boolean} showBodyPreviewInBody 通知本文に投稿冒頭を表示するか
 * @property {boolean} sessionExpiredNotifyEnabled ログイン切れの初回のみ通知するか
 * @property {number} settingsVersion 設定データの形式バージョン
 */

/**
 * @returns {Settings}
 */
function defaultSettings() {
  return {
    monitorUrl: "",
    checkIntervalMinutes: DEFAULT_CHECK_INTERVAL_MINUTES,
    topics: [],
    desktopNotificationsEnabled: true,
    showAuthorInBody: true,
    showBodyPreviewInBody: true,
    sessionExpiredNotifyEnabled: false,
    settingsVersion: CURRENT_SETTINGS_VERSION
  };
}

/**
 * 旧形式のトピック（{name, enabled}のみで、id/urlを持たない）かどうかを判定する。
 * @param {object} topic
 * @returns {boolean}
 */
function isLegacyTopic(topic) {
  return !!topic && typeof topic === "object" && !("id" in topic) && !("url" in topic);
}

/**
 * v0.1.x以前の固定2件・トピック名のみの設定を、v0.2.0の動的トピック設定へ移行する。
 * 移行後のトピックは、URLが未設定のため安全側でOFFへ変更し、`migrationRequired`を
 * 立てる。移行は`settingsVersion`で管理し、複数回実行しても重複生成しない。
 * @param {object|undefined} existing
 * @returns {object|undefined} 移行後の設定オブジェクト。移行不要な場合は引数をそのまま返す。
 */
function migrateSettingsIfNeeded(existing) {
  if (!existing) return existing;
  if (typeof existing.settingsVersion === "number" && existing.settingsVersion >= CURRENT_SETTINGS_VERSION) {
    return existing;
  }

  if (!Array.isArray(existing.topics)) {
    const { firstCheckDone, ...rest } = existing;
    return { ...rest, topics: [], settingsVersion: CURRENT_SETTINGS_VERSION };
  }

  const looksLegacy = existing.topics.some(isLegacyTopic);
  if (!looksLegacy) {
    return { ...existing, settingsVersion: CURRENT_SETTINGS_VERSION };
  }

  const migratedTopics = existing.topics.map((legacyTopic) =>
    createTopicConfig({
      id: generateId(),
      // URLが無いままでは新着照合ができないため、安全側としてOFFへ変更する。
      enabled: false,
      name: typeof legacyTopic?.name === "string" ? legacyTopic.name : "",
      url: "",
      forumId: null,
      topicId: null,
      firstCheckDone: false,
      migrationRequired: true
    })
  );

  // 旧トップレベルのfirstCheckDoneマップは、各トピック設定内で管理する方式へ
  // 置き換えたため破棄する。
  const { firstCheckDone, ...rest } = existing;
  return { ...rest, topics: migratedTopics, settingsVersion: CURRENT_SETTINGS_VERSION };
}

/**
 * @returns {Promise<Settings>}
 */
export async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const existing = stored[STORAGE_KEYS.SETTINGS];

  if (!existing) {
    return defaultSettings();
  }

  const migrated = migrateSettingsIfNeeded(existing);
  if (migrated !== existing) {
    // 移行が発生した場合は即座に永続化し、次回以降は移行処理が再実行されないようにする。
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: migrated });
  }

  return {
    ...defaultSettings(),
    ...migrated,
    topics: Array.isArray(migrated.topics) ? migrated.topics : []
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
 * すべてのトピックの初回確認完了フラグをリセットする（設定画面の「初回確認状態に戻す」用）。
 */
export async function resetAllFirstCheckDone() {
  const current = await getSettings();
  const topics = current.topics.map((topic) => ({ ...topic, firstCheckDone: false }));
  await saveSettings({ topics });
}

/**
 * @param {Settings} settings
 * @returns {TopicConfig[]}
 */
export function getEnabledTopicConfigs(settings) {
  return settings.topics.filter((topic) => topic.enabled);
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

const TOPIC_URL_ERROR_MESSAGES = {
  "invalid-url": "URLの形式が正しくありません。",
  "missing-cmd": "トピックURLの形式が正しくありません（電子会議室のトピックを開いた状態のURLを貼り付けてください）。",
  "missing-fid": "URLから会議室ID（fid）を取得できません。",
  "missing-tid": "URLからトピックID（tid）を取得できません。"
};

/**
 * 設定画面から入力されたトピック設定の配列を検証・正規化する。
 *
 * - 名称・URLの両方が空の行は「未入力の追加直後カード」とみなし、保存対象から除外する
 *   （エラーにはしない）。
 * - 片方だけ入力されている行、または通知ONの行は、名称・URLの両方が必須。
 * - URLは同一オリジン（monitorUrl側）であること、cmd=forumalistであること、
 *   fid・tidが取得できることを検証する。
 * - forumId・topicIdの組み合わせが重複する行があれば、全体を保存拒否する。
 * - 登録件数（保存対象として残った件数）が上限を超える場合も保存拒否する。
 *
 * @param {{id: string, enabled: boolean, name: string, url: string}[]} rawTopics
 * @param {string} monitorUrl 新着情報画面の正規化済みURL（未設定の場合は空文字）
 * @returns {{
 *   ok: boolean,
 *   topics: TopicConfig[],
 *   fieldErrors: Object.<number, string[]>,
 *   duplicateError: string|null,
 *   countError: string|null
 * }}
 */
export function validateTopicConfigsForSave(rawTopics, monitorUrl) {
  const fieldErrors = {};
  const topics = [];

  rawTopics.forEach((raw, index) => {
    const name = normalizeTopicName(raw.name);
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    const enabled = !!raw.enabled;

    // 追加直後の未入力カードは、保存対象から静かに除外する（エラーにはしない）。
    if (name === "" && url === "") {
      return;
    }

    const errors = [];

    if (name === "") {
      errors.push("トピック名を入力してください。");
    }

    // 通知ONの場合は名称・URLの両方を必須とする。通知OFFの場合、URLが未入力の
    // 行は「移行直後などURL未設定の保留中トピック」として保存を許可する
    // （旧設定からの移行直後に、全カードのURL入力を強制して保存自体をブロック
    // しないため）。URLが入力されている場合は、ON/OFFに関わらず内容を検証する。
    let parsedUrl = null;
    if (url === "") {
      if (enabled) {
        errors.push("電子会議室のトピックURLを入力してください。");
      }
    } else {
      parsedUrl = parseTopicUrl(url);
      if (!parsedUrl.ok) {
        errors.push(TOPIC_URL_ERROR_MESSAGES[parsedUrl.reason] || "URLの形式が正しくありません。");
      } else if (monitorUrl && !isSameOrigin(parsedUrl.url, monitorUrl)) {
        errors.push("新着情報画面と異なるサーバーのURLは登録できません。");
      }
    }

    if (errors.length > 0) {
      fieldErrors[index] = errors;
      return;
    }

    topics.push(
      createTopicConfig({
        id: raw.id || generateId(),
        enabled,
        name,
        url: parsedUrl ? parsedUrl.url : "",
        forumId: parsedUrl ? parsedUrl.forumId : null,
        topicId: parsedUrl ? parsedUrl.topicId : null,
        firstCheckDone: !!raw.firstCheckDone,
        migrationRequired: false
      })
    );
  });

  let duplicateError = null;
  const seenPairs = new Set();
  for (const topic of topics) {
    if (!topic.forumId || !topic.topicId) continue;
    const pairKey = `${topic.forumId}|${topic.topicId}`;
    if (seenPairs.has(pairKey)) {
      duplicateError = "同じ電子会議室トピックが複数登録されています。";
      break;
    }
    seenPairs.add(pairKey);
  }

  let countError = null;
  if (topics.length > MAX_TOPICS) {
    countError = "通知対象は最大20件まで登録できます。";
  }

  return {
    ok: Object.keys(fieldErrors).length === 0 && !duplicateError && !countError,
    topics,
    fieldErrors,
    duplicateError,
    countError
  };
}

/**
 * 保存直前の（検証済み）トピック一覧に対して、初回確認完了フラグを整理する。
 * - 新規追加されたトピック（同じidが以前に存在しない）は必ずfalseへ
 * - forumId・topicIdが変わった（別トピックとみなす）場合はfalseへ
 * - OFF→ONに変わった場合は、安全側としてfalseへ戻す
 *   （長期間OFFの間の投稿が履歴に残っておらず、ON直後に古い投稿を誤通知するのを防ぐ）
 * - 上記以外（名称のみ変更、ON→OFF、変化なし）は既存のfirstCheckDoneを維持する
 * @param {TopicConfig[]} previousTopics 保存前のトピック一覧
 * @param {TopicConfig[]} newTopics 保存しようとしているトピック一覧
 * @returns {TopicConfig[]} firstCheckDoneを調整したトピック一覧
 */
export function reconcileFirstCheckDoneOnSave(previousTopics, newTopics) {
  const previousById = new Map(previousTopics.map((topic) => [topic.id, topic]));

  return newTopics.map((topic) => {
    const previous = previousById.get(topic.id);

    if (!previous) {
      return { ...topic, firstCheckDone: false };
    }

    const idsChanged = previous.forumId !== topic.forumId || previous.topicId !== topic.topicId;
    const turnedOn = !previous.enabled && topic.enabled;

    if (idsChanged || turnedOn) {
      return { ...topic, firstCheckDone: false };
    }

    return { ...topic, firstCheckDone: previous.firstCheckDone === true };
  });
}
