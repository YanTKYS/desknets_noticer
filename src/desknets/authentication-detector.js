// desknet's NEOのページ状態（正常 / 未ログイン / 想定外画面）を判定する。
//
// 正常な新着情報画面のマーカー（jforum-topiclink等）は実機確認済みだが、ログイン切れ
// 画面・エラー画面そのものは未確認のため、その判定は一般的なグループウェアの傾向に
// もとづくヒューリスティック（複数条件のOR判定）である。実画面のHTMLを入手できた
// 場合は判定条件を見直すこと（docs/desknets-v6-dom-investigation.md 参照）。

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
