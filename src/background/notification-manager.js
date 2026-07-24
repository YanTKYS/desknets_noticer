// chrome.notifications によるデスクトップ通知の作成とクリック時の遷移処理。

import { EXTENSION_NAME, INDIVIDUAL_NOTIFICATION_LIMIT } from "../shared/constants.js";
import { normalizeWhitespace, truncateText } from "../shared/text-utils.js";
import { isSameOrigin, pickBestMatchingTab } from "../desknets/url-utils.js";

const NOTIFICATION_URL_MAP_KEY = "notificationUrlMap";

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
  const title = post.topicName
    ? `${post.topicName}に新規投稿`
    : `${EXTENSION_NAME}: 新規投稿があります`;

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
        await chrome.notifications.create(notificationId, {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title,
          message,
          silent: false
        });
        await rememberNotificationUrl(notificationId, post.url || fallbackUrl);
      }
    } else {
      const { title, message } = buildGroupedNotification(topicName, posts.length);
      const notificationId = `desknets-noticer-group-${Date.now()}-${sequence++}`;
      await chrome.notifications.create(notificationId, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title,
        message,
        silent: false
      });
      await rememberNotificationUrl(notificationId, fallbackUrl);
    }
  }
}

/**
 * ログイン切れへ状態が変化した最初の1回だけ通知する。
 * @param {string} fallbackUrl
 */
export async function notifyAuthRequiredOnce(fallbackUrl) {
  const notificationId = `desknets-noticer-auth-${Date.now()}`;
  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: EXTENSION_NAME,
    message: "desknet's NEOへのログインが必要です。ブラウザでログインし直してください。",
    silent: false
  });
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
