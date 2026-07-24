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

/**
 * desknet's NEOはハッシュルーティング（例: "#cmd=forumalist&fid=8&tid=2319&init=1"）を
 * 使用しており、fid・tidなどの識別子は通常のクエリパラメーターではなく
 * ハッシュ部分に含まれる。ハッシュ文字列をURLSearchParamsとして解析し、
 * 指定した名前のいずれかに一致する値を取り出す。
 * @param {URL|null} url
 * @param {string[]} paramNames
 * @returns {string|null}
 */
export function extractHashParam(url, paramNames) {
  if (!url || !url.hash) return null;

  const rawHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const params = new URLSearchParams(rawHash);

  for (const name of paramNames) {
    const value = params.get(name);
    if (value) return value;
  }

  return null;
}

/**
 * 通知クリック時／「電子会議室を開く」時に再利用する既存タブを選ぶ。
 * 優先順位:
 *   1. 対象URLと完全一致するタブ
 *   2. 同一オリジンかつ zforum.exe を開いているタブ（desknet's NEOの電子会議室CGI）
 *   3. 同一オリジンの任意のタブ
 *   4. 該当なし（呼び出し側で新規タブを開く）
 * @param {{id: number, url?: string, windowId?: number}[]} tabs
 * @param {string} targetUrl
 * @returns {{id: number, url?: string, windowId?: number}|null}
 */
export function pickBestMatchingTab(tabs, targetUrl) {
  if (!Array.isArray(tabs) || tabs.length === 0) return null;

  const sameOriginTabs = tabs.filter((tab) => tab.url && isSameOrigin(tab.url, targetUrl));
  if (sameOriginTabs.length === 0) return null;

  const exactMatch = sameOriginTabs.find((tab) => tab.url === targetUrl);
  if (exactMatch) return exactMatch;

  const zforumMatch = sameOriginTabs.find((tab) => {
    try {
      return new URL(tab.url).pathname.toLowerCase().includes("zforum.exe");
    } catch {
      return false;
    }
  });
  if (zforumMatch) return zforumMatch;

  return sameOriginTabs[0];
}
