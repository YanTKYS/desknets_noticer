// chrome.notifications によるデスクトップ通知の作成とクリック時の遷移処理。

import { EXTENSION_NAME, INDIVIDUAL_NOTIFICATION_LIMIT, TEST_NOTIFICATION_ID_PREFIX, ERROR_CODES } from "../shared/constants.js";
import { normalizeWhitespace, truncateText } from "../shared/text-utils.js";
import { isSameOrigin, pickBestMatchingTab } from "../desknets/url-utils.js";

const NOTIFICATION_URL_MAP_KEY = "notificationUrlMap";

/**
 * 通知アイコンの拡張機能内URLを取得する。
 * chrome.notifications.create() へ相対パス（例: "icons/icon128.png"）をそのまま
 * 渡すと、サービスワーカーのコンテキストでは相対URL解決に失敗し
 * 「Unable to download all specified images」エラーになることがある。
 * 必ず chrome.runtime.getURL() で拡張機能内の絶対URLへ変換してから使用する。
 * @returns {string}
 */
export function getNotificationIconUrl() {
  return chrome.runtime.getURL("icons/icon128.png");
}

/**
 * エラーメッセージから、アイコン画像の取得失敗によるものかどうかを判定する。
 * @param {unknown} error
 * @returns {string}
 */
function classifyNotificationError(error) {
  const message = error && error.message ? String(error.message) : String(error);
  if (message.includes("Unable to download all specified images")) {
    return ERROR_CODES.NOTIFICATION_ICON_LOAD_FAILED;
  }
  return ERROR_CODES.NOTIFICATION_API_ERROR;
}

/**
 * chrome.notifications.create() の共通呼び出し処理。
 * 失敗時は原因を診断できる情報（アイコンURLとエラー内容）だけをConsoleへ出力する
 * （投稿本文・職員名・内部URLなど利用者データはログへ出さない）。
 * @param {string} notificationId
 * @param {chrome.notifications.NotificationOptions} options
 * @returns {Promise<{ok: boolean, errorCode?: string}>}
 */
async function createNotificationSafely(notificationId, options) {
  try {
    await chrome.notifications.create(notificationId, options);
    return { ok: true };
  } catch (error) {
    console.error("[desknets_noticer] 通知の作成に失敗しました。", {
      iconUrl: options.iconUrl,
      error
    });
    return { ok: false, errorCode: classifyNotificationError(error) };
  }
}

/**
 * 通知IDに紐づく遷移先URLを一時保存する（chrome.storage.sessionはブラウザ再起動で消える）。
 * @param {string} notificationId
 * @param {string} url
 */
async function rememberNotificationUrl(notificationId, url) {
  const stored = await chrome.storage.session.get(NOTIFICATION_URL_MAP_KEY);
  const map = stored[NOTIFICATION_URL_MAP_KEY] || {};
  map[notificationId] = url;
  await chrome.storage.session.set({ [NOTIFICATION_URL_MAP_KEY]: map });
}

/**
 * @param {string} notificationId
 * @returns {Promise<string|null>}
 */
async function recallNotificationUrl(notificationId) {
  const stored = await chrome.storage.session.get(NOTIFICATION_URL_MAP_KEY);
  const map = stored[NOTIFICATION_URL_MAP_KEY] || {};
  return map[notificationId] || null;
}

/**
 * 1件分の投稿から通知タイトル・本文を組み立てる。
 * @param {import("../shared/models.js").ForumPost} post
 * @param {{showAuthorInBody: boolean, showBodyPreviewInBody: boolean}} options
 * @returns {{title: string, message: string}}
 */
function buildSinglePostNotification(post, options) {
  const title = post.topicName ? `${post.topicName}に新規投稿` : "電子会議室に新規投稿";

  const parts = [];
  if (options.showAuthorInBody && post.author) {
    parts.push(`${post.author}さん`);
  }
  if (options.showBodyPreviewInBody && post.bodyPreview) {
    parts.push(post.bodyPreview);
  }
  if (parts.length === 0 && post.postedAt) {
    parts.push(post.postedAt);
  }
  if (parts.length === 0) {
    parts.push("新しい投稿があります。詳細は電子会議室でご確認ください。");
  }

  const message = truncateText(normalizeWhitespace(parts.join("：")), 120);
  return { title, message };
}

/**
 * @param {string} topicName
 * @param {number} count
 * @returns {{title: string, message: string}}
 */
function buildGroupedNotification(topicName, count) {
  return {
    title: `${topicName}に新規投稿`,
    message: `新着 ${count} 件があります。電子会議室でご確認ください。`
  };
}

/**
 * トピックごとの新規投稿から通知を作成する。
 * 1〜3件は個別通知、4件以上はトピックごとにまとめて通知する。
 * @param {Map<string, import("../shared/models.js").ForumPost[]>} postsByTopic
 * @param {{showAuthorInBody: boolean, showBodyPreviewInBody: boolean}} options
 * @param {string} fallbackUrl 個別投稿URLが無い場合の遷移先
 */
export async function notifyNewPosts(postsByTopic, options, fallbackUrl) {
  let sequence = 0;

  for (const [topicName, posts] of postsByTopic.entries()) {
    if (posts.length === 0) continue;

    if (posts.length <= INDIVIDUAL_NOTIFICATION_LIMIT) {
      for (const post of posts) {
        const { title, message } = buildSinglePostNotification(post, options);
        const notificationId = `desknets-noticer-${Date.now()}-${sequence++}`;
        const result = await createNotificationSafely(notificationId, {
          type: "basic",
          iconUrl: getNotificationIconUrl(),
          title,
          message,
          silent: false
        });
        if (!result.ok) continue;
        // クリック時に開くURLの優先順位: 1.新着画面から取得した投稿側URL
        // 2.登録されたトピックURL 3.新着情報画面URL
        await rememberNotificationUrl(notificationId, post.url || post.__topicConfigUrl || fallbackUrl);
      }
    } else {
      const { title, message } = buildGroupedNotification(topicName, posts.length);
      const notificationId = `desknets-noticer-group-${Date.now()}-${sequence++}`;
      const result = await createNotificationSafely(notificationId, {
        type: "basic",
        iconUrl: getNotificationIconUrl(),
        title,
        message,
        silent: false
      });
      if (!result.ok) continue;
      await rememberNotificationUrl(notificationId, posts[0]?.__topicConfigUrl || fallbackUrl);
    }
  }
}

/**
 * desknet's NEOへは一切アクセスせず、chrome.notifications.create() だけを実行する
 * テスト通知。Windows・Chromeの通知機能そのものが利用できるかを切り分けるためのもの。
 * 通知作成要求が成功したかどうかまでしか判定できず、実際にWindowsのバナーへ
 * 表示されたかどうかは判定できない。
 * @returns {Promise<{ok: boolean, errorCode?: string}>}
 */
export async function sendTestNotification() {
  if (typeof chrome === "undefined" || !chrome.notifications || typeof chrome.notifications.create !== "function") {
    return { ok: false, errorCode: ERROR_CODES.NOTIFICATION_PERMISSION_UNAVAILABLE };
  }

  const notificationId = `${TEST_NOTIFICATION_ID_PREFIX}${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return createNotificationSafely(notificationId, {
    type: "basic",
    iconUrl: getNotificationIconUrl(),
    title: "desknets_noticer テスト通知",
    message: "Chrome拡張から通知を送信しました。この通知が表示されれば、端末の通知機能を利用できます。",
    silent: false
  });
}

/**
 * ログイン切れへ状態が変化した最初の1回だけ通知する。
 * @param {string} fallbackUrl
 */
export async function notifyAuthRequiredOnce(fallbackUrl) {
  const notificationId = `desknets-noticer-auth-${Date.now()}`;
  const result = await createNotificationSafely(notificationId, {
    type: "basic",
    iconUrl: getNotificationIconUrl(),
    title: EXTENSION_NAME,
    message: "desknet's NEOへのログインが必要です。ブラウザでログインし直してください。",
    silent: false
  });
  if (!result.ok) return;
  await rememberNotificationUrl(notificationId, fallbackUrl);
}

/**
 * 通知クリック時に、対象URLを開く。同一オリジンのdesknet's NEOタブが既にあれば
 * そのタブを対象URLへ遷移させてアクティブにし、なければ新規タブを開く。
 * @param {string} notificationId
 * @param {string} configuredOriginUrl 通知クリックで開く前に同一オリジンかを検証する基準URL
 */
export async function handleNotificationClick(notificationId, configuredOriginUrl) {
  const url = await recallNotificationUrl(notificationId);
  await chrome.notifications.clear(notificationId);
  if (!url) return;

  // 通知クリックで開くURLが、設定済みのdesknet's NEOと同一オリジンであることを必ず確認する。
  if (!isSameOrigin(url, configuredOriginUrl)) return;

  const tabs = await chrome.tabs.query({});
  const existingTab = pickBestMatchingTab(tabs, url);

  if (existingTab) {
    await chrome.tabs.update(existingTab.id, { url, active: true });
    if (existingTab.windowId != null) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url });
  }
}
