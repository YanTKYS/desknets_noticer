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
      sendResponse({ ok: true, pageState: pageState.state, posts: [], recognizedCount: 0, matchedCount: 0, parserMode: "unknown" });
      return undefined;
    }

    const result = parseNewArrivals(doc, message.enabledTopicNames, message.documentBaseUrl);
    sendResponse({
      ok: true,
      pageState: "ok",
      posts: result.matchedPosts,
      recognizedCount: result.recognizedCount,
      matchedCount: result.matchedCount,
      parserMode: result.parserMode
    });
  } catch (error) {
    sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  }

  return undefined;
});
