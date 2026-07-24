// desknet's NEO 電子会議室「新着情報」画面のDOM解析処理を集約するアダプター。
//
// desknet's NEOの画面構造が変わった場合は、このファイルだけを修正すればよいように
// 解析ロジックをここに集約している。
//
// セレクターの安定性についての方針（優先順位）:
//   1. 投稿ID・トピックID・会議室IDなどの内部識別子（data-*属性等）
//   2. リンクURLとそのクエリパラメーター
//   3. data-*属性、id属性、意味のある要素構造
//   4. ラベル文字列と相対的なDOM構造
//   5. CSSクラス名（最も不安定なため最終手段）
//
// 重要: 実際のdesknet's NEO v6.0 R1.0画面のHTMLはまだ十分に確認できていない。
// 下記のセレクターは「一般的な業務グループウェアの新着情報一覧」を想定した
// 暫定実装であり、docs/desknets-v6-dom-investigation.md に記載のとおり
// 未確認の部分を含む。実画面のHTMLが提供され次第、本ファイルのセレクターを
// 調整すること。

import { createForumPost } from "../shared/models.js";
import { normalizeWhitespace, truncateText } from "../shared/text-utils.js";
import { PARSER_MODE } from "../shared/constants.js";

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
 * @param {Document} doc DOMParserで解析済みの新着情報画面
 * @param {string[]} enabledTopicNames 通知対象として有効化されているトピック名の一覧
 * @param {string} documentBaseUrl 相対URLを絶対URLへ変換するためのベースURL
 * @returns {{
 *   posts: import("../shared/models.js").ForumPost[],
 *   matchedPosts: import("../shared/models.js").ForumPost[],
 *   recognizedCount: number,
 *   matchedCount: number,
 *   parserMode: string
 * }}
 */
export function parseNewArrivals(doc, enabledTopicNames, documentBaseUrl) {
  const { rows, mode } = findCandidateRows(doc);

  const posts = [];
  for (const row of rows) {
    const post = parseRow(row, mode, documentBaseUrl);
    if (post) posts.push(post);
  }

  const enabledSet = new Set(enabledTopicNames || []);
  const matchedPosts = posts.filter((post) => post.topicName && enabledSet.has(post.topicName));

  return {
    posts,
    matchedPosts,
    recognizedCount: posts.length,
    matchedCount: matchedPosts.length,
    parserMode: mode
  };
}
