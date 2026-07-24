// desknet's NEOのページ状態（正常 / 未ログイン / 想定外画面）を判定する。
//
// 実機確認により、電子会議室の新着情報画面ではjforum-topiclink / jforum-forumlink
// といったCSSクラスが使われていることが判明した（docs/desknets-v6-dom-investigation.md
// 参照）。一方、ログイン切れ画面・エラー画面そのものは未確認のため、ここでの判定は
// 引き続きヒューリスティック（推測に基づく複数条件のOR判定）である。
// 実画面のHTMLが提供され次第、選定基準を見直すこと。

const LOGIN_KEYWORDS = ["ログイン", "login", "sign in", "パスワードを入力"];
const SESSION_EXPIRED_KEYWORDS = [
  "セッションが切れ",
  "セッションタイムアウト",
  "再度ログイン",
  "session expired",
  "session timeout"
];
const PERMISSION_DENIED_KEYWORDS = [
  "アクセス権がありません",
  "権限がありません",
  "permission denied",
  "access denied"
];

/**
 * @param {Document} document DOMParserで解析済みのHTML文書
 * @returns {{ state: "ok" | "auth_required" | "permission_denied" | "unexpected_page", reason: string }}
 */
export function detectPageState(document) {
  if (!document || !document.documentElement) {
    return { state: "unexpected_page", reason: "empty-document" };
  }

  const bodyText = (document.body?.textContent || "").toLowerCase();
  const title = (document.title || "").toLowerCase();
  const combinedText = `${title} ${bodyText}`;

  const hasPasswordField = !!document.querySelector('input[type="password"]');
  const hasLoginKeyword = LOGIN_KEYWORDS.some((keyword) =>
    combinedText.includes(keyword.toLowerCase())
  );
  if (hasPasswordField || hasLoginKeyword) {
    return { state: "auth_required", reason: "login-form-or-keyword" };
  }

  const hasSessionExpiredKeyword = SESSION_EXPIRED_KEYWORDS.some((keyword) =>
    combinedText.includes(keyword.toLowerCase())
  );
  if (hasSessionExpiredKeyword) {
    return { state: "auth_required", reason: "session-expired-keyword" };
  }

  const hasPermissionKeyword = PERMISSION_DENIED_KEYWORDS.some((keyword) =>
    combinedText.includes(keyword.toLowerCase())
  );
  if (hasPermissionKeyword) {
    return { state: "permission_denied", reason: "permission-denied-keyword" };
  }

  // 新着情報画面らしい構造の手がかりが1つもない場合は「想定外の画面」として扱う。
  // jforum-topiclink / jforum-forumlink は実機確認済みのdesknet's NEO v6.0 R1.0の
  // マーカー。それ以外のセレクターは実画面未確認の汎用パーサー向けの手がかり。
  const looksLikeForumPage = !!document.querySelector(
    [
      "a.jforum-topiclink",
      "a.jforum-forumlink",
      "[data-post-id]",
      "[data-topic-id]",
      "[data-room-id]",
      'a[href*="cabinet"]',
      'a[href*="bbs"]',
      'a[href*="forum"]'
    ].join(", ")
  );
  if (!looksLikeForumPage) {
    return { state: "unexpected_page", reason: "no-forum-page-markers" };
  }

  return { state: "ok", reason: "forum-page-markers-found" };
}
