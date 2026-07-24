// テキスト整形・ハッシュ生成のユーティリティ。

/**
 * 改行や連続空白を1つの半角スペースに正規化する。
 * @param {string} text
 * @returns {string}
 */
export function normalizeWhitespace(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 指定文字数程度に省略する（80〜120文字を目安に、maxを超えたら"…"を付ける）。
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncateText(text, maxLength = 120) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

/**
 * HTMLタグやスクリプトを除去したプレーンテキストを返す。
 * textContent由来の文字列を渡す想定だが、念のためタグらしき文字列も除去する。
 * @param {string} text
 * @returns {string}
 */
export function stripHtmlArtifacts(text) {
  if (typeof text !== "string") return "";
  return text.replace(/<[^>]*>/g, "");
}

/**
 * 文字列からSHA-256ハッシュ（16進文字列）を生成する。
 * Web Crypto API（crypto.subtle）を利用するため、拡張機能のページ／
 * サービスワーカーいずれのコンテキストでも利用可能。
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function sha256Hex(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 投稿の識別キーとして使う正規化済み複合文字列を作る。
 * 投稿IDが取得できない画面（会議室ID・トピックID・トピック名・投稿者・投稿日時・
 * 投稿概要の組み合わせ）でも、投稿ごとに安定した識別キーを作れるようにする。
 * 区切り文字には通常のテキストに出現しにくい制御文字（U+001F）を使う。
 * @param {{roomId?: string|null, topicId?: string|null, topicName?: string|null, author?: string|null, postedAt?: string|null, bodyPreview?: string|null}} post
 * @returns {string}
 */
export function buildCompositeKeySource(post) {
  return [
    post.roomId || "",
    post.topicId || "",
    post.topicName || "",
    post.author || "",
    post.postedAt || "",
    post.bodyPreview || ""
  ]
    .map((part) => normalizeWhitespace(String(part)))
    .join("");
}
