// 新着情報画面から取得した投稿と、設定済みの通知対象トピック（TopicConfig）を
// 照合するロジックを集約する。
//
// 優先順位:
//   1. forumId（会議室ID）とtopicId（トピックID）の両方が一致
//   2. forumId・topicIdを持たない設定（旧設定など）に限り、トピック名の完全一致
//   3. 上記に一致しない投稿は対象外（通知しない）
//
// これにより、トピック名が変更されても会議室ID・トピックIDが同じであれば
// 同一トピックとして継続して検知できる。

/**
 * 1件の投稿に一致するトピック設定を探す。
 * @param {import("../shared/models.js").ForumPost} post
 * @param {import("../shared/models.js").TopicConfig[]} topicConfigs
 * @returns {import("../shared/models.js").TopicConfig|null}
 */
export function findMatchingTopicConfig(post, topicConfigs) {
  if (post.roomId && post.topicId) {
    const byId = topicConfigs.find(
      (config) => config.forumId && config.topicId && config.forumId === post.roomId && config.topicId === post.topicId
    );
    if (byId) return byId;
  }

  // フォールバック: forumId/topicIdを持たない設定（未移行の旧設定等）に限り、
  // トピック名の完全一致で照合する。
  return (
    topicConfigs.find(
      (config) => (!config.forumId || !config.topicId) && config.name && post.topicName === config.name
    ) || null
  );
}

/**
 * 投稿一覧を、一致するトピック設定とペアにして返す。一致しない投稿は除外される。
 * @param {import("../shared/models.js").ForumPost[]} posts
 * @param {import("../shared/models.js").TopicConfig[]} topicConfigs
 * @returns {{post: import("../shared/models.js").ForumPost, config: import("../shared/models.js").TopicConfig}[]}
 */
export function matchPostsToTopicConfigs(posts, topicConfigs) {
  const pairs = [];
  for (const post of posts) {
    const config = findMatchingTopicConfig(post, topicConfigs);
    if (config) pairs.push({ post, config });
  }
  return pairs;
}
