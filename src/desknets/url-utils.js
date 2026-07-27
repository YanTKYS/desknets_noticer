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
 * 使用しており、fid・tidなどの識別子は通常のクエリパラメーター（URL.searchParams）
 * ではなく、ハッシュ部分に含まれる。ハッシュ文字列をURLSearchParamsとして解析する。
 * @param {URL|null} url
 * @returns {URLSearchParams}
 */
export function getHashParams(url) {
  if (!url || !url.hash) return new URLSearchParams("");
  const rawHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  return new URLSearchParams(rawHash);
}

/**
 * ハッシュ部分から、指定した名前のいずれかに一致する値を取り出す。
 * @param {URL|null} url
 * @param {string[]} paramNames
 * @returns {string|null}
 */
export function extractHashParam(url, paramNames) {
  const params = getHashParams(url);
  for (const name of paramNames) {
    const value = params.get(name);
    if (value) return value;
  }
  return null;
}

/**
 * @typedef {Object} TopicUrlParseResult
 * @property {boolean} ok
 * @property {string} [url] 正規化済みURL（okの場合のみ）
 * @property {string} [forumId]
 * @property {string} [topicId]
 * @property {"empty"|"invalid-url"|"missing-cmd"|"missing-fid"|"missing-tid"} [reason] 失敗理由（!okの場合のみ）
 */

/**
 * 電子会議室のトピックURLを検証し、会議室ID（fid）・トピックID（tid）を抽出する。
 * このオリジンが新着情報画面URLと同一かどうかまでは検証しない（呼び出し側で判定する）。
 * @param {string} rawUrl
 * @returns {TopicUrlParseResult}
 */
export function parseTopicUrl(rawUrl) {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (trimmed === "") {
    return { ok: false, reason: "empty" };
  }

  const normalizedUrl = validateAndNormalizeUrl(trimmed);
  if (!normalizedUrl) {
    return { ok: false, reason: "invalid-url" };
  }

  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  const params = getHashParams(parsed);

  if (params.get("cmd") !== "forumalist") {
    return { ok: false, reason: "missing-cmd", url: normalizedUrl };
  }

  const forumId = params.get("fid");
  if (!forumId) {
    return { ok: false, reason: "missing-fid", url: normalizedUrl };
  }

  const topicId = params.get("tid");
  if (!topicId) {
    return { ok: false, reason: "missing-tid", url: normalizedUrl };
  }

  return { ok: true, url: normalizedUrl, forumId, topicId };
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
