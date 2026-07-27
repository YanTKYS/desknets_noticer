// データ構造の生成ヘルパー。TypeScriptを使わないため、JSDocで形状を明示する。

/**
 * @typedef {Object} ForumPost
 * @property {string|null} roomName 会議室名
 * @property {string|null} roomId 会議室ID（取得できる場合）
 * @property {string|null} topicName トピック名
 * @property {string|null} topicId トピックID（取得できる場合）
 * @property {string|null} postId 投稿ID（取得できる場合）
 * @property {string|null} author 投稿者名
 * @property {string|null} postedAt 投稿日時（表示文字列のまま）
 * @property {string|null} bodyPreview 投稿本文の冒頭
 * @property {string|null} url 投稿を開くURL
 * @property {string} parserMode どの解析方式で取得できたか
 */

/**
 * @param {Partial<ForumPost>} partial
 * @returns {ForumPost}
 */
export function createForumPost(partial) {
  return {
    roomName: partial.roomName ?? null,
    roomId: partial.roomId ?? null,
    topicName: partial.topicName ?? null,
    topicId: partial.topicId ?? null,
    postId: partial.postId ?? null,
    author: partial.author ?? null,
    postedAt: partial.postedAt ?? null,
    bodyPreview: partial.bodyPreview ?? null,
    url: partial.url ?? null,
    parserMode: partial.parserMode ?? "unknown"
  };
}

/**
 * @typedef {Object} TopicConfig
 * @property {string} id 拡張機能内部の設定行識別子（desknet's NEOのIDとは無関係）
 * @property {boolean} enabled 通知の有効/無効
 * @property {string} name 表示用トピック名（利用者が入力）
 * @property {string} url 登録されたトピックURL
 * @property {string|null} forumId desknet's NEOの会議室ID（fid）。URLから解析
 * @property {string|null} topicId desknet's NEOのトピックID（tid）。URLから解析
 * @property {boolean} firstCheckDone このトピックの初回確認が完了したか
 * @property {boolean} [migrationRequired] 旧設定からの移行直後で、URL再設定が必要か
 */

/**
 * @param {Partial<TopicConfig>} partial
 * @returns {TopicConfig}
 */
export function createTopicConfig(partial = {}) {
  return {
    id: partial.id ?? null,
    enabled: partial.enabled ?? false,
    name: partial.name ?? "",
    url: partial.url ?? "",
    forumId: partial.forumId ?? null,
    topicId: partial.topicId ?? null,
    firstCheckDone: partial.firstCheckDone ?? false,
    migrationRequired: partial.migrationRequired ?? false
  };
}

/**
 * @typedef {Object} CheckDebugInfo
 * @property {string|null} lastCheckedAt ISO日時
 * @property {string} fetchResultType "success" | "http-error" | "network-error"
 * @property {number} recognizedCount 認識した投稿件数
 * @property {number} matchedCount 対象トピック一致件数
 * @property {number} newCount 新規判定件数
 * @property {string} parserMode 使用した解析方式
 * @property {number|null} topicLinkCount desknet's NEO v6専用パーサーが検出したトピックリンク件数
 * @property {number|null} rowCandidateCount 投稿行の候補として認識した件数
 * @property {boolean|null} topicNameFoundInHtml 設定済みトピック名がHTML本文内に見つかったか
 * @property {string|null} errorCode
 */

export function createDebugInfo(partial) {
  return {
    lastCheckedAt: partial.lastCheckedAt ?? null,
    fetchResultType: partial.fetchResultType ?? "unknown",
    recognizedCount: partial.recognizedCount ?? 0,
    matchedCount: partial.matchedCount ?? 0,
    newCount: partial.newCount ?? 0,
    parserMode: partial.parserMode ?? "unknown",
    topicLinkCount: partial.topicLinkCount ?? null,
    rowCandidateCount: partial.rowCandidateCount ?? null,
    topicNameFoundInHtml: partial.topicNameFoundInHtml ?? null,
    errorCode: partial.errorCode ?? null
  };
}
