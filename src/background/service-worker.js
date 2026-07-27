// バックグラウンドサービスワーカー。定期確認・通知・状態管理を統括する。
//
// 実行順序:
//   1. chrome.alarms / 起動時 / 「今すぐ確認」から runCheck() が呼ばれる
//   2. desknet's NEOの新着情報画面をfetchで取得（読み取り専用、credentials: include）
//   3. サービスワーカーにはDOM APIが無いため、オフスクリーンドキュメントへHTMLを渡してDOM解析する
//   4. 解析結果ともとに、forumId・topicId（無ければトピック名）を優先して
//      設定済みトピックと照合し、新規投稿を判定・通知する
//
// 新着情報画面は1回だけ取得し、登録済みの全トピックと照合する
// （トピックURLごとに個別fetchは行わない。登録件数が増えても通信回数は変わらない）。

import { ALARM_NAME, ERROR_CODES, STATUS, TEST_NOTIFICATION_ID_PREFIX } from "../shared/constants.js";
import { getSettings, getEnabledTopicConfigs, saveSettings } from "../storage/settings-store.js";
import { getRuntimeState, updateRuntimeState } from "../storage/runtime-state-store.js";
import * as historyStore from "../storage/notification-history-store.js";
import { fetchNewArrivalsHtml } from "../desknets/client.js";
import { validateAndNormalizeUrl } from "../desknets/url-utils.js";
import { matchPostsToTopicConfigs } from "../desknets/topic-matcher.js";
import { ensureAlarm } from "./alarm-manager.js";
import {
  notifyNewPosts,
  notifyAuthRequiredOnce,
  handleNotificationClick,
  sendTestNotification
} from "./notification-manager.js";
import { createDebugInfo, createForumPost } from "../shared/models.js";
import { sha256Hex, buildCompositeKeySource } from "../shared/text-utils.js";

let isCheckInProgress = false;

async function ensureOffscreenDocument() {
  const hasDocument = await chrome.offscreen.hasDocument?.();
  if (hasDocument) return;

  await chrome.offscreen.createDocument({
    url: "src/offscreen/offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "desknet's NEOの新着情報画面HTMLをDOM解析するため（サービスワーカーにはDOM APIが無いため）"
  });
}

/**
 * @param {string} html
 * @param {string[]} enabledTopicNames
 * @param {string} documentBaseUrl
 */
async function parseHtmlInOffscreen(html, enabledTopicNames, documentBaseUrl) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({
    type: "parse-new-arrivals-html",
    html,
    enabledTopicNames,
    documentBaseUrl
  });
}

/**
 * 投稿の識別キーを計算する。投稿IDがあればそれを優先し、無ければ複合情報のハッシュを使う。
 * @param {import("../shared/models.js").ForumPost} post
 * @returns {Promise<string>}
 */
async function computeIdentifierKey(post) {
  if (post.postId) {
    return `id:${post.roomId || ""}:${post.topicId || post.topicName || ""}:${post.postId}`;
  }
  const compositeSource = buildCompositeKeySource(post);
  const hash = await sha256Hex(compositeSource);
  return `hash:${hash}`;
}

/**
 * @param {string} errorCode
 * @param {string} status
 * @param {string} fetchResultType
 */
async function recordFailure(errorCode, status, fetchResultType) {
  await updateRuntimeState({
    status,
    lastCheckedAt: new Date().toISOString(),
    debugInfo: createDebugInfo({
      lastCheckedAt: new Date().toISOString(),
      fetchResultType,
      errorCode
    })
  });
}

/**
 * 新着情報確認処理の本体。同時に複数実行されないよう isCheckInProgress で排他制御する。
 * 想定外の例外が発生しても「確認中」のまま残らないよう、外側で必ず捕捉し、
 * 状態を「最終確認でエラー」へ更新したうえで、呼び出し元へ失敗結果を返す。
 * @returns {Promise<{ok: boolean, errorCode?: string}>}
 */
export async function runCheck() {
  if (isCheckInProgress) return { ok: true, skipped: true };
  isCheckInProgress = true;

  try {
    await performCheck();
    return { ok: true };
  } catch (error) {
    console.error("[desknets_noticer] runCheck: 想定外のエラーが発生しました。", error);
    await recordFailure(ERROR_CODES.UNEXPECTED_ERROR, STATUS.LAST_CHECK_ERROR, "unexpected-error");
    return { ok: false, errorCode: ERROR_CODES.UNEXPECTED_ERROR };
  } finally {
    isCheckInProgress = false;
  }
}

/**
 * runCheckの本処理。想定内のエラー（未設定・接続失敗・認証切れ等）はここで
 * recordFailureを呼んだうえで正常にreturnする。想定外の例外はrunCheck側の
 * catchで処理する。
 */
async function performCheck() {
  const settings = await getSettings();

  const normalizedUrl = validateAndNormalizeUrl(settings.monitorUrl);
  if (!normalizedUrl) {
    await updateRuntimeState({ status: STATUS.NOT_CONFIGURED });
    return;
  }

  await updateRuntimeState({ status: STATUS.CHECKING });

  const enabledConfigs = getEnabledTopicConfigs(settings);
  if (enabledConfigs.length === 0) {
    await updateRuntimeState({
      status: STATUS.OK,
      lastCheckedAt: new Date().toISOString(),
      debugInfo: createDebugInfo({ lastCheckedAt: new Date().toISOString(), fetchResultType: "skipped" })
    });
    return;
  }

  const enabledTopicNames = enabledConfigs.map((config) => config.name).filter(Boolean);

  const fetchResult = await fetchNewArrivalsHtml(normalizedUrl);
  if (fetchResult.type === "network-error") {
    await recordFailure(ERROR_CODES.CONNECTION_FAILED, STATUS.CONNECTION_FAILED, fetchResult.type);
    return;
  }
  if (fetchResult.type === "http-error") {
    const code = fetchResult.statusCode === 401 || fetchResult.statusCode === 403
      ? ERROR_CODES.AUTH_REQUIRED
      : ERROR_CODES.CONNECTION_FAILED;
    const status = code === ERROR_CODES.AUTH_REQUIRED ? STATUS.AUTH_REQUIRED : STATUS.CONNECTION_FAILED;
    await handleAuthTransition(status, settings, normalizedUrl);
    await recordFailure(code, status, fetchResult.type);
    return;
  }

  let parseResponse;
  try {
    parseResponse = await parseHtmlInOffscreen(fetchResult.html, enabledTopicNames, normalizedUrl);
  } catch {
    await recordFailure(ERROR_CODES.PARSER_FAILED, STATUS.LAST_CHECK_ERROR, fetchResult.type);
    return;
  }

  if (!parseResponse || !parseResponse.ok) {
    await recordFailure(ERROR_CODES.PARSER_FAILED, STATUS.LAST_CHECK_ERROR, fetchResult.type);
    return;
  }

  if (parseResponse.pageState === "auth_required" || parseResponse.pageState === "permission_denied") {
    await handleAuthTransition(STATUS.AUTH_REQUIRED, settings, normalizedUrl);
    await recordFailure(ERROR_CODES.AUTH_REQUIRED, STATUS.AUTH_REQUIRED, fetchResult.type);
    return;
  }

  if (parseResponse.pageState === "unexpected_page") {
    await recordFailure(ERROR_CODES.UNEXPECTED_PAGE, STATUS.UNEXPECTED_PAGE, fetchResult.type);
    return;
  }

  // 正常にページを認識できた場合はログイン切れ状態から復帰したとみなす。
  await updateRuntimeState({ lastAuthRequiredNotified: false });

  const posts = (parseResponse.posts || []).map((post) => createForumPost(post));
  const matchedPairs = matchPostsToTopicConfigs(posts, enabledConfigs);
  const { newPostsByTopic, newCount, firstCheckDoneUpdatesById } = await classifyPosts(enabledConfigs, matchedPairs);

  if (Object.keys(firstCheckDoneUpdatesById).length > 0) {
    const updatedTopics = settings.topics.map((topic) =>
      firstCheckDoneUpdatesById[topic.id] ? { ...topic, firstCheckDone: true } : topic
    );
    await saveSettings({ topics: updatedTopics });
  }

  if (newCount > 0 && settings.desktopNotificationsEnabled) {
    await notifyNewPosts(
      newPostsByTopic,
      {
        showAuthorInBody: settings.showAuthorInBody,
        showBodyPreviewInBody: settings.showBodyPreviewInBody
      },
      normalizedUrl
    );
  }

  // トピックリンクが1件も見つからず、かつ何も認識できなかった場合は、パーサーが
  // 画面変更に追従できていない可能性がある。ただし新着一覧が実際に空の可能性も
  // あるため、状態はOKのまま維持し、診断情報にだけ記録する。
  const diagnosticErrorCode =
    parseResponse.topicLinkCount === 0 && parseResponse.recognizedCount === 0
      ? ERROR_CODES.NO_TOPIC_LINKS_FOUND
      : null;

  const previousState = await getRuntimeState();
  const lastDetectedTopicNames =
    newCount > 0
      ? Array.from(new Set([...(previousState.lastDetectedTopicNames || []), ...newPostsByTopic.keys()]))
      : previousState.lastDetectedTopicNames || [];

  await updateRuntimeState({
    status: STATUS.OK,
    lastCheckedAt: new Date().toISOString(),
    newCountSinceLastPopupOpen: previousState.newCountSinceLastPopupOpen + newCount,
    lastDetectedTopicNames,
    debugInfo: createDebugInfo({
      lastCheckedAt: new Date().toISOString(),
      fetchResultType: fetchResult.type,
      recognizedCount: parseResponse.recognizedCount,
      matchedCount: parseResponse.matchedCount,
      newCount,
      parserMode: parseResponse.parserMode,
      topicLinkCount: parseResponse.topicLinkCount,
      rowCandidateCount: parseResponse.rowCandidateCount,
      topicNameFoundInHtml: parseResponse.topicNameFoundInHtml,
      errorCode: diagnosticErrorCode
    })
  });

  if (newCount > 0) {
    await chrome.action.setBadgeText({ text: String(previousState.newCountSinceLastPopupOpen + newCount) });
    await chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
  }
}

/**
 * ログイン切れへ「正常→ログイン切れ」に変化した最初の1回だけ通知する。
 * @param {string} newStatus
 * @param {import("../storage/settings-store.js").Settings} settings
 * @param {string} normalizedUrl
 */
async function handleAuthTransition(newStatus, settings, normalizedUrl) {
  if (newStatus !== STATUS.AUTH_REQUIRED) return;
  if (!settings.sessionExpiredNotifyEnabled) return;

  const previousState = await getRuntimeState();
  const wasOkBefore = previousState.status === STATUS.OK || previousState.status === STATUS.CHECKING;
  const alreadyNotified = previousState.lastAuthRequiredNotified === true;

  if (wasOkBefore && !alreadyNotified) {
    await notifyAuthRequiredOnce(normalizedUrl);
    await updateRuntimeState({ lastAuthRequiredNotified: true });
  }
}

/**
 * 有効なトピック設定ごとに新規投稿を判定する。
 * トピックが初回確認済みでない場合は、現在の投稿を基準値として登録するのみで通知しない
 * （このラウンドに一致する投稿が0件でも、初回確認自体は完了として扱う）。
 * @param {import("../shared/models.js").TopicConfig[]} enabledConfigs
 * @param {{post: import("../shared/models.js").ForumPost, config: import("../shared/models.js").TopicConfig}[]} matchedPairs
 * @returns {Promise<{
 *   newPostsByTopic: Map<string, import("../shared/models.js").ForumPost[]>,
 *   newCount: number,
 *   firstCheckDoneUpdatesById: Object.<string, boolean>
 * }>}
 */
export async function classifyPosts(enabledConfigs, matchedPairs) {
  const postsByConfigId = new Map();
  for (const { post, config } of matchedPairs) {
    if (!postsByConfigId.has(config.id)) postsByConfigId.set(config.id, []);
    postsByConfigId.get(config.id).push(post);
  }

  const newPostsByTopic = new Map();
  let newCount = 0;
  const keysToRegister = [];
  const firstCheckDoneUpdatesById = {};

  for (const config of enabledConfigs) {
    const posts = postsByConfigId.get(config.id) || [];
    const isFirstCheck = config.firstCheckDone !== true;

    const keyedPosts = [];
    for (const post of posts) {
      const key = await computeIdentifierKey(post);
      keyedPosts.push({ post, key });
    }

    if (isFirstCheck) {
      for (const { key } of keyedPosts) keysToRegister.push(key);
      firstCheckDoneUpdatesById[config.id] = true;
      continue;
    }

    const newPosts = [];
    for (const { post, key } of keyedPosts) {
      const alreadyNotified = await historyStore.hasKey(key);
      if (!alreadyNotified) {
        newPosts.push({ ...post, __topicConfigUrl: config.url || null });
        keysToRegister.push(key);
      }
    }

    if (newPosts.length > 0) {
      // 通知タイトルは、新着画面から実際に取得したトピック名を優先し、
      // 無ければ設定済みのトピック名を使う。
      const displayName = newPosts[0].topicName || config.name || null;
      const groupKey = displayName || `config:${config.id}`;
      const existing = newPostsByTopic.get(groupKey) || [];
      newPostsByTopic.set(groupKey, existing.concat(newPosts));
      newCount += newPosts.length;
    }
  }

  await historyStore.addKeys(keysToRegister);

  return { newPostsByTopic, newCount, firstCheckDoneUpdatesById };
}

async function handleRunNowMessage() {
  return runCheck();
}

async function handleSettingsUpdatedMessage() {
  const settings = await getSettings();
  await ensureAlarm(settings.checkIntervalMinutes);
  return runCheck();
}

async function handleTestConnectionMessage(url) {
  const normalizedUrl = validateAndNormalizeUrl(url);
  if (!normalizedUrl) {
    return { ok: false, errorCode: ERROR_CODES.NOT_CONFIGURED, message: "URLの形式が正しくありません。" };
  }

  const fetchResult = await fetchNewArrivalsHtml(normalizedUrl);
  if (fetchResult.type === "network-error") {
    return { ok: false, errorCode: ERROR_CODES.CONNECTION_FAILED, message: "接続できませんでした。" };
  }
  if (fetchResult.type === "http-error") {
    return { ok: false, errorCode: ERROR_CODES.CONNECTION_FAILED, message: `HTTPエラー（${fetchResult.statusCode}）です。` };
  }

  try {
    const settings = await getSettings();
    const enabledTopicNames = getEnabledTopicConfigs(settings).map((config) => config.name).filter(Boolean);
    const parseResponse = await parseHtmlInOffscreen(fetchResult.html, enabledTopicNames, normalizedUrl);
    if (!parseResponse || !parseResponse.ok) {
      return { ok: false, errorCode: ERROR_CODES.PARSER_FAILED, message: "画面の解析に失敗しました。" };
    }
    if (parseResponse.pageState === "auth_required" || parseResponse.pageState === "permission_denied") {
      return { ok: false, errorCode: ERROR_CODES.AUTH_REQUIRED, message: "desknet's NEOへのログインが必要です。" };
    }
    if (parseResponse.pageState === "unexpected_page") {
      return { ok: false, errorCode: ERROR_CODES.UNEXPECTED_PAGE, message: "新着情報画面として認識できませんでした。" };
    }

    const noTopicLinksFound = parseResponse.topicLinkCount === 0 && parseResponse.recognizedCount === 0;
    const suffix = noTopicLinksFound
      ? "（トピックリンクを検出できませんでした。画面が変更された可能性があります）"
      : "";

    return {
      ok: true,
      errorCode: noTopicLinksFound ? ERROR_CODES.NO_TOPIC_LINKS_FOUND : null,
      message:
        `接続に成功しました（認識した投稿件数: ${parseResponse.recognizedCount}件 / ` +
        `対象一致: ${parseResponse.matchedCount}件）。${suffix}`
    };
  } catch {
    return { ok: false, errorCode: ERROR_CODES.PERMISSION_DENIED, message: "サイトへのアクセス権限が不足しています。" };
  }
}

async function handleSendTestNotificationMessage() {
  try {
    const result = await sendTestNotification();
    if (result.ok) {
      return {
        ok: true,
        message:
          "通知の作成要求に成功しました。\n表示されない場合は、WindowsまたはChromeの通知設定を確認してください。"
      };
    }
    return {
      ok: false,
      errorCode: result.errorCode || ERROR_CODES.TEST_NOTIFICATION_FAILED,
      message: "テスト通知を作成できませんでした。"
    };
  } catch (error) {
    console.error("[desknets_noticer] テスト通知メッセージの処理に失敗しました。", error);
    return { ok: false, errorCode: ERROR_CODES.TEST_NOTIFICATION_FAILED, message: "テスト通知を作成できませんでした。" };
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runCheck();
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  // テスト通知のクリックはdesknet's NEOを開く必要が無いため、通知を閉じるだけにする。
  if (notificationId.startsWith(TEST_NOTIFICATION_ID_PREFIX)) {
    await chrome.notifications.clear(notificationId);
    return;
  }

  const settings = await getSettings();
  const normalizedUrl = validateAndNormalizeUrl(settings.monitorUrl);
  if (!normalizedUrl) return;
  await handleNotificationClick(notificationId, normalizedUrl);
});

/**
 * メッセージハンドラーの想定外の例外を捕捉し、必ず何らかの結果をポップアップ／
 * 設定画面へ返す（sendResponseが呼ばれないまま終わることを防ぐ）。
 * @param {Promise<object>} handlerPromise
 * @param {(result: object) => void} sendResponse
 */
function respondSafely(handlerPromise, sendResponse) {
  handlerPromise
    .then((result) => sendResponse(result ?? { ok: true }))
    .catch((error) => {
      console.error("[desknets_noticer] メッセージ処理で想定外のエラーが発生しました。", error);
      sendResponse({ ok: false, errorCode: ERROR_CODES.UNEXPECTED_ERROR });
    });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "run-now") {
    respondSafely(handleRunNowMessage(), sendResponse);
    return true;
  }
  if (message?.type === "settings-updated") {
    respondSafely(handleSettingsUpdatedMessage(), sendResponse);
    return true;
  }
  if (message?.type === "test-connection") {
    respondSafely(handleTestConnectionMessage(message.url), sendResponse);
    return true;
  }
  if (message?.type === "send-test-notification") {
    respondSafely(handleSendTestNotificationMessage(), sendResponse);
    return true;
  }
  return undefined;
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await ensureAlarm(settings.checkIntervalMinutes);
  await runCheck();
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await ensureAlarm(settings.checkIntervalMinutes);
  await runCheck();
});
