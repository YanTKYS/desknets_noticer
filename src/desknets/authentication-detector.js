// desknet's NEOのページ状態（正常 / 未ログイン / 想定外画面）を判定する。
//
// 実際のdesknet's NEO v6.0 R1.0のログイン切れ画面・エラー画面は、まだ実機で
// 確認できていない（docs/desknets-v6-dom-investigation.md を参照）。
// そのため、ここでの判定はヒューリスティック（推測に基づく複数条件のOR判定）であり、
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
  // desknet's NEOの実画面確認後、より確実な判定条件（新着情報一覧のコンテナ要素など）に
  // 置き換えること。
  const looksLikeForumPage = !!document.querySelector(
    '[data-post-id], [data-topic-id], [data-room-id], a[href*="cabinet"], a[href*="bbs"], a[href*="forum"]'
  );
  if (!looksLikeForumPage) {
    return { state: "unexpected_page", reason: "no-forum-page-markers" };
  }

  return { state: "ok", reason: "forum-page-markers-found" };
}
