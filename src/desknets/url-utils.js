// desknet's NEO接続先URLの検証・正規化ユーティリティ。
// ソースコードにURLを固定せず、利用者が設定したURLのみを扱う。

/**
 * 入力されたURL文字列を検証し、正規化した文字列を返す。
 * - 前後の空白を除去する
 * - http / https のみ許可する
 * - 末尾スラッシュの差異を正規化する（ルートパス以外は末尾スラッシュを削除）
 * 不正な場合はnullを返す。
 * @param {string} rawInput
 * @returns {string|null}
 */
export function validateAndNormalizeUrl(rawInput) {
  if (typeof rawInput !== "string") return null;
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  let pathname = parsed.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "");
    if (pathname === "") pathname = "/";
  }
  parsed.pathname = pathname;

  return parsed.toString();
}

/**
 * 2つのURLが同一オリジンかどうかを判定する。
 * 通知クリック時に開くURLが、設定済みのdesknet's NEOと同一オリジンであることの
 * 確認に用いる。
 * @param {string} urlA
 * @param {string} urlB
 * @returns {boolean}
 */
export function isSameOrigin(urlA, urlB) {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

/**
 * URLからオリジン（host_permissions用のパターン）を取り出す。
 * 例: "https://groupware.example.local/cgi-bin/x" -> "https://groupware.example.local/*"
 * @param {string} url
 * @returns {string|null}
 */
export function toOriginPermissionPattern(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}
