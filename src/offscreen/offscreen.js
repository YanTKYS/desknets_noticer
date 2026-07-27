// オフスクリーンドキュメント：サービスワーカーにはDOM APIが無いため、
// HTML文字列のDOM解析だけをこの隠しページ内で行う。
// 画面表示や利用者操作は一切行わない。

import { detectPageState } from "../desknets/authentication-detector.js";
import { parseNewArrivals } from "../desknets/forum-parser.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "parse-new-arrivals-html") return undefined;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(message.html, "text/html");

    const pageState = detectPageState(doc);
    if (pageState.state !== "ok") {
      sendResponse({
        ok: true,
        pageState: pageState.state,
        posts: [],
        recognizedCount: 0,
        matchedCount: 0,
        parserMode: "unknown",
        topicLinkCount: 0,
        rowCandidateCount: 0,
        topicNameFoundInHtml: null
      });
      return undefined;
    }

    const result = parseNewArrivals(doc, message.enabledTopicNames, message.documentBaseUrl);
    sendResponse({
      ok: true,
      pageState: "ok",
      // forumId/topicId（無ければトピック名）を優先した実際の照合はservice-worker側で
      // 行うため、認識できた投稿はすべて返す（matchedPostsに絞り込まない）。
      posts: result.posts,
      recognizedCount: result.recognizedCount,
      matchedCount: result.matchedCount,
      parserMode: result.parserMode,
      topicLinkCount: result.topicLinkCount,
      rowCandidateCount: result.rowCandidateCount,
      topicNameFoundInHtml: result.topicNameFoundInHtml
    });
  } catch (error) {
    sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  }

  return undefined;
});
