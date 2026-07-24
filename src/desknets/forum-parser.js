// desknet's NEO 電子会議室「新着情報」画面のDOM解析処理を集約するアダプター。
//
// desknet's NEOの画面構造が変わった場合は、このファイルだけを修正すればよいように
// 解析ロジックをここに集約している。
//
// desknet's NEO v6.0 R1.0の実機確認により、実際のDOM構造（jforum-topiclink等の
// CSSクラス、data-fid/data-tid属性、ハッシュルーティングのURL）が判明したため、
// 専用パーサー（PARSER_MODE.DESKNETS_V6）を最優先で実行する。
// 詳細はdocs/desknets-v6-dom-investigation.mdを参照。
//
// v6専用パーサーが1件もトピックリンクを検出できなかった場合にのみ、
// 以下の汎用パーサー（実画面未確認の暫定実装）へフォールバックする。
// セレクターの安定性についての方針（優先順位）:
//   1. 投稿ID・トピックID・会議室IDなどの内部識別子（data-*属性等）
//   2. リンクURLとそのクエリパラメーター
//   3. data-*属性、id属性、意味のある要素構造
//   4. ラベル文字列と相対的なDOM構造
//   5. CSSクラス名（最も不安定なため最終手段）

import { createForumPost } from "../shared/models.js";
import { normalizeWhitespace, truncateText } from "../shared/text-utils.js";
import { PARSER_MODE } from "../shared/constants.js";
import { extractHashParam } from "./url-utils.js";

// --- desknet's NEO v6.0 R1.0 実DOM専用パーサー ---------------------------------

const DESKNETS_V6_TOPIC_LINK_SELECTOR = "a.jforum-topiclink[data-fid][data-tid]";
const DESKNETS_V6_FORUM_LINK_SELECTOR = "a.jforum-forumlink[data-fid]";
const DESKNETS_V6_MEMO_SELECTOR = ".forum-top-list-memo";
const DESKNETS_V6_AUTHOR_CONTAINER_SELECTOR = ".forum-top-list-name";
const DESKNETS_V6_DATE_SELECTOR = ".forum-top-list-date";

/**
 * <br>要素を改行として扱ったうえで、script/style要素を除いたテキストを取得する。
 * textContentだけでは<br>が単なる境界の消失になり、隣接する文言が連結されて
 * しまうため、通知表示の可読性のために改行へ変換してから取得する。
 * @param {Element} el
 * @returns {string}
 */
function extractTextPreservingLineBreaks(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("script, style").forEach((node) => node.remove());
  clone.querySelectorAll("br").forEach((br) => {
    br.replaceWith(el.ownerDocument.createTextNode("\n"));
  });
  return clone.textContent || "";
}

/**
 * a.jforum-topiclink[data-fid][data-tid] を手がかりに投稿候補の行（tr）を集める。
 * 同じtrが複数のリンクから重複して選ばれないよう重複排除する。
 * :has()セレクターには依存しない。
 * @param {Document} doc
 * @returns {{ topicLinkCount: number, rows: Element[] }}
 */
function findDesknetsV6Rows(doc) {
  const topicLinks = Array.from(doc.querySelectorAll(DESKNETS_V6_TOPIC_LINK_SELECTOR));

  const rows = [];
  const seen = new Set();
  for (const link of topicLinks) {
    const row = link.closest("tr");
    if (!row || seen.has(row)) continue;
    seen.add(row);
    rows.push(row);
  }

  return { topicLinkCount: topicLinks.length, rows };
}

/**
 * 1件のtr要素から、desknet's NEO v6の実DOM構造にもとづいてForumPostを組み立てる。
 * 一部の項目が欠落していても例外を投げず、取得できた範囲で返す。
 * @param {Element} row
 * @param {string} documentBaseUrl リンクの絶対URL化・ハッシュパラメーター解決に使うベースURL
 * @returns {import("../shared/models.js").ForumPost|null}
 */
function parseDesknetsV6Row(row, documentBaseUrl) {
  try {
    const topicLink = row.querySelector(DESKNETS_V6_TOPIC_LINK_SELECTOR);
    if (!topicLink) return null;

    // トピック名は完全一致判定に使うため、前後の空白・改行のみ除去し、
    // 内部の連続空白の変換や大文字小文字・全角半角の変換は行わない。
    const topicNameRaw = topicLink.getAttribute("title") || topicLink.textContent || "";
    const topicName = topicNameRaw.trim();
    if (!topicName) return null;

    let parsedUrl = null;
    let url = null;
    const href = topicLink.getAttribute("href");
    if (href) {
      try {
        parsedUrl = new URL(href, documentBaseUrl);
        url = parsedUrl.toString();
      } catch {
        url = null;
      }
    }

    const forumLink = row.querySelector(DESKNETS_V6_FORUM_LINK_SELECTOR);
    const roomName = forumLink
      ? normalizeWhitespace(forumLink.getAttribute("title") || forumLink.textContent || "") || null
      : null;
    const roomId =
      forumLink?.dataset.fid || topicLink.dataset.fid || extractHashParam(parsedUrl, ["fid"]) || null;
    const topicId = topicLink.dataset.tid || extractHashParam(parsedUrl, ["tid"]) || null;

    const memoEl = row.querySelector(DESKNETS_V6_MEMO_SELECTOR);
    const bodyPreviewRaw = memoEl ? extractTextPreservingLineBreaks(memoEl) : "";
    const bodyPreview = bodyPreviewRaw ? truncateText(normalizeWhitespace(bodyPreviewRaw), 120) : null;

    const nameContainer = row.querySelector(DESKNETS_V6_AUTHOR_CONTAINER_SELECTOR);
    let author = null;
    if (nameContainer) {
      const authorSpan = nameContainer.querySelector("span");
      const spanValue = authorSpan
        ? normalizeWhitespace(authorSpan.getAttribute("title") || authorSpan.textContent || "")
        : "";
      author = spanValue || normalizeWhitespace(nameContainer.textContent || "") || null;
    }

    const dateEl = row.querySelector(DESKNETS_V6_DATE_SELECTOR);
    const postedAt = dateEl ? normalizeWhitespace(dateEl.textContent || "") || null : null;

    return createForumPost({
      roomName,
      roomId,
      topicName,
      topicId,
      postId: null,
      author,
      postedAt,
      bodyPreview,
      url,
      parserMode: PARSER_MODE.DESKNETS_V6
    });
  } catch {
    // 1行の解析に失敗しても、全体の解析処理は継続する。
    return null;
  }
}

/**
 * 設定済みの通知対象トピック名が、HTML本文のテキストとして存在するかどうかを調べる。
 * 対象一致件数が0件のとき、パーサーの不一致（画面変更）なのか、単純な
 * トピック名の設定ミスなのかを利用者・開発者が切り分けるための診断情報。
 * @param {Document} doc
 * @param {string[]} enabledTopicNames
 * @returns {boolean|null} 有効なトピックが1件も設定されていない場合はnull
 */
function checkTopicNameFoundInHtml(doc, enabledTopicNames) {
  if (!enabledTopicNames || enabledTopicNames.length === 0) return null;
  const bodyText = doc.body?.textContent || "";
  return enabledTopicNames.some((name) => typeof name === "string" && name !== "" && bodyText.includes(name));
}

// --- 汎用パーサー（実画面未確認の暫定実装、v6専用パーサーのフォールバック用） -----

const ROW_SELECTOR_STRATEGIES = [
  {
    mode: PARSER_MODE.IDENTIFIER,
    selector: "[data-post-id], [data-topic-post-id], [data-forum-post]"
  },
  {
    mode: PARSER_MODE.DATA_ATTRIBUTES,
    selector: "[data-room-name][data-topic-name], [data-room-id][data-topic-id]"
  },
  {
    mode: PARSER_MODE.LABEL_TEXT,
    selector:
      '#newArrivalList li, #newArrivalList tr, .newArrivalList li, .newArrivalList tr, [id*="new" i][id*="arrival" i] li, [id*="new" i][id*="arrival" i] tr'
  },
  {
    mode: PARSER_MODE.CSS_CLASS,
    selector: "table.newArrivals tr, ul.newArrivals li, .new-arrival-item, .forum-new-item"
  }
];

// 行の中から投稿へのリンクを探すための手がかり。
const POST_LINK_SELECTOR =
  'a[href*="cabinet"], a[href*="bbs"], a[href*="forum"], a[href*="topic"], a[href*="post"], a[href]';

/**
 * @param {Document} doc
 * @returns {{ rows: Element[], mode: string }}
 */
function findCandidateRows(doc) {
  for (const strategy of ROW_SELECTOR_STRATEGIES) {
    const rows = Array.from(doc.querySelectorAll(strategy.selector));
    if (rows.length > 0) {
      return { rows, mode: strategy.mode };
    }
  }
  return { rows: [], mode: PARSER_MODE.UNKNOWN };
}

/**
 * ラベル文字列（例: "会議室:"）の直後に続くテキストを取得する。
 * @param {Element} row
 * @param {string[]} labels
 * @returns {string|null}
 */
function extractByLabel(row, labels) {
  const text = extractSafeText(row);
  for (const label of labels) {
    const index = text.indexOf(label);
    if (index !== -1) {
      const after = text.slice(index + label.length);
      const match = after.match(/^[\s:：]*([^\n]+)/);
      if (match) {
        const value = normalizeWhitespace(match[1]).split(/\s{2,}/)[0];
        if (value) return value;
      }
    }
  }
  return null;
}

/**
 * script/style要素の内容を除いたtextContentを取得する。
 * DOM解析結果を通知文へ利用するため、埋め込まれたスクリプト等の文字列が
 * 混入しないようにする。
 * @param {Element} el
 * @returns {string}
 */
function extractSafeText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("script, style").forEach((node) => node.remove());
  return clone.textContent || "";
}

/**
 * @param {Element} row
 * @param {string} dataAttr
 * @param {string[]} cssSelectors
 * @param {string[]} labels
 * @returns {string|null}
 */
function extractField(row, dataAttr, cssSelectors, labels) {
  if (dataAttr && row.getAttribute(dataAttr)) {
    return normalizeWhitespace(row.getAttribute(dataAttr));
  }
  for (const selector of cssSelectors) {
    const el = row.querySelector(selector);
    if (el) {
      const value = normalizeWhitespace(el.getAttribute("content") || extractSafeText(el));
      if (value) return value;
    }
  }
  if (labels && labels.length > 0) {
    const value = extractByLabel(row, labels);
    if (value) return value;
  }
  return null;
}

/**
 * リンクのクエリパラメーターから識別子を抜き出す。
 * @param {URL|null} url
 * @param {string[]} paramNames
 * @returns {string|null}
 */
function extractParam(url, paramNames) {
  if (!url) return null;
  for (const name of paramNames) {
    const value = url.searchParams.get(name);
    if (value) return value;
  }
  return null;
}

/**
 * 1行分の要素からForumPostを組み立てる。
 * 一部の項目が欠落していても例外を投げず、取得できた範囲で返す。
 * @param {Element} row
 * @param {string} baseMode
 * @param {string} documentBaseUrl リンクの絶対URL化に使うベースURL
 * @returns {import("../shared/models.js").ForumPost|null}
 */
function parseRow(row, baseMode, documentBaseUrl) {
  try {
    const linkEl = row.querySelector(POST_LINK_SELECTOR);
    let url = null;
    let parsedUrl = null;
    if (linkEl) {
      const href = linkEl.getAttribute("href");
      if (href) {
        try {
          parsedUrl = new URL(href, documentBaseUrl);
          url = parsedUrl.toString();
        } catch {
          url = null;
        }
      }
    }

    const postId =
      row.getAttribute("data-post-id") ||
      extractParam(parsedUrl, ["post_no", "postid", "post_id", "res_no"]);
    const roomId =
      row.getAttribute("data-room-id") ||
      extractParam(parsedUrl, ["cabinet_id", "room_id", "folder_id"]);
    const topicId =
      row.getAttribute("data-topic-id") ||
      extractParam(parsedUrl, ["topic_id", "bbs_id", "thread_id"]);

    const roomName = extractField(
      row,
      "data-room-name",
      [".room-name", ".cabinet-name", ".forum-room"],
      ["会議室:", "会議室名:"]
    );
    const topicName = extractField(
      row,
      "data-topic-name",
      [".topic-name", ".bbs-name", ".forum-topic"],
      ["トピック:", "トピック名:"]
    );
    const author = extractField(
      row,
      "data-author",
      [".author", ".poster-name", ".user-name"],
      ["投稿者:", "投稿者名:"]
    );
    const postedAt = extractField(
      row,
      "data-posted-at",
      ["time[datetime]", ".posted-at", ".post-date"],
      ["投稿日時:", "日時:"]
    );
    const bodyPreviewRaw = extractField(
      row,
      "data-body-preview",
      [".body-preview", ".post-body", ".summary"],
      ["本文冒頭:", "本文:"]
    );

    const post = createForumPost({
      roomName,
      roomId,
      topicName,
      topicId,
      postId,
      author,
      postedAt,
      bodyPreview: bodyPreviewRaw ? truncateText(bodyPreviewRaw, 120) : null,
      url,
      parserMode: postId || roomId || topicId ? PARSER_MODE.IDENTIFIER : baseMode
    });

    // トピック名すら取得できない行は投稿として扱わない（ノイズ行の可能性が高い）。
    if (!post.topicName) return null;

    return post;
  } catch {
    // 1行の解析に失敗しても、全体の解析処理は継続する。
    return null;
  }
}

/**
 * 新着情報画面のDocumentから、対象トピックの投稿一覧を抽出する。
 * desknet's NEO v6専用パーサー（jforum-topiclink等）を最優先で実行し、
 * トピックリンクが1件も見つからない場合にのみ汎用パーサーへフォールバックする。
 * @param {Document} doc DOMParserで解析済みの新着情報画面
 * @param {string[]} enabledTopicNames 通知対象として有効化されているトピック名の一覧
 * @param {string} documentBaseUrl 相対URLを絶対URLへ変換するためのベースURL
 * @returns {{
 *   posts: import("../shared/models.js").ForumPost[],
 *   matchedPosts: import("../shared/models.js").ForumPost[],
 *   recognizedCount: number,
 *   matchedCount: number,
 *   parserMode: string,
 *   topicLinkCount: number,
 *   rowCandidateCount: number,
 *   topicNameFoundInHtml: boolean|null
 * }}
 */
export function parseNewArrivals(doc, enabledTopicNames, documentBaseUrl) {
  const { topicLinkCount, rows: v6Rows } = findDesknetsV6Rows(doc);

  let posts = [];
  let mode;
  let rowCandidateCount;

  if (topicLinkCount > 0) {
    mode = PARSER_MODE.DESKNETS_V6;
    rowCandidateCount = v6Rows.length;
    for (const row of v6Rows) {
      const post = parseDesknetsV6Row(row, documentBaseUrl);
      if (post) posts.push(post);
    }
  } else {
    const { rows, mode: genericMode } = findCandidateRows(doc);
    mode = genericMode;
    rowCandidateCount = rows.length;
    for (const row of rows) {
      const post = parseRow(row, genericMode, documentBaseUrl);
      if (post) posts.push(post);
    }
  }

  const enabledSet = new Set(enabledTopicNames || []);
  const matchedPosts = posts.filter((post) => post.topicName && enabledSet.has(post.topicName));

  return {
    posts,
    matchedPosts,
    recognizedCount: posts.length,
    matchedCount: matchedPosts.length,
    parserMode: mode,
    topicLinkCount,
    rowCandidateCount,
    topicNameFoundInHtml: checkTopicNameFoundInHtml(doc, enabledTopicNames)
  };
}
