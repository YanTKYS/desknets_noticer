// desknet's NEOの新着情報画面を読み取り専用で取得するクライアント。
// 投稿・既読化・更新・削除など、状態を変更するリクエストは一切行わない。

/**
 * @typedef {Object} FetchResult
 * @property {"success"|"http-error"|"network-error"} type
 * @property {string|null} html 取得できたHTML本文（successの場合のみ）
 * @property {number|null} statusCode
 */

/**
 * 新着情報画面をGETで取得する。
 * ログイン済みのブラウザCookieがそのまま使われるよう credentials: "include" を指定する。
 * 認証情報（ID・パスワード・Cookie）を拡張機能側で保存・生成することは行わない。
 * @param {string} url
 * @returns {Promise<FetchResult>}
 */
export async function fetchNewArrivalsHtml(url) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store"
    });
  } catch {
    return { type: "network-error", html: null, statusCode: null };
  }

  if (!response.ok) {
    return { type: "http-error", html: null, statusCode: response.status };
  }

  const html = await response.text();
  return { type: "success", html, statusCode: response.status };
}
