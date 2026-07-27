import test from "node:test";
import assert from "node:assert/strict";

import { findMatchingTopicConfig, matchPostsToTopicConfigs } from "../src/desknets/topic-matcher.js";

function makePost(overrides = {}) {
  return {
    roomId: "8",
    topicId: "2319",
    topicName: "公用車予約キャンセル周知用",
    author: "テスト太郎",
    postedAt: "07/24 15:14",
    bodyPreview: "本文",
    url: "https://example.local/1",
    ...overrides
  };
}

function makeConfig(overrides = {}) {
  return {
    id: "cfg-1",
    enabled: true,
    name: "公用車予約キャンセル周知用",
    url: "",
    forumId: "8",
    topicId: "2319",
    firstCheckDone: false,
    ...overrides
  };
}

test("forumIdとtopicIdの一致を優先する", () => {
  const config = makeConfig({ name: "別の表示名になっていても一致する" });
  const post = makePost();
  const matched = findMatchingTopicConfig(post, [config]);
  assert.equal(matched.id, "cfg-1");
});

test("名称が変わってもforumId・topicIdが同じなら検知できる", () => {
  const config = makeConfig({ name: "旧名称" });
  const post = makePost({ topicName: "新名称" });
  const matched = findMatchingTopicConfig(post, [config]);
  assert.equal(matched.id, "cfg-1");
});

test("同名でforumId・topicIdが違うトピックを区別できる", () => {
  const configA = makeConfig({ id: "cfg-a", name: "同じ名前", forumId: "8", topicId: "2319" });
  const configB = makeConfig({ id: "cfg-b", name: "同じ名前", forumId: "9", topicId: "4471" });
  const postForB = makePost({ roomId: "9", topicId: "4471", topicName: "同じ名前" });

  const matched = findMatchingTopicConfig(postForB, [configA, configB]);
  assert.equal(matched.id, "cfg-b");
});

test("IDが無い旧設定のみトピック名の完全一致でフォールバックする", () => {
  const legacyConfig = makeConfig({ id: "cfg-legacy", forumId: null, topicId: null, name: "公用車予約キャンセル周知用" });
  const post = makePost({ roomId: "999", topicId: "999" }); // IDは一致しないがフォールバック対象

  const matched = findMatchingTopicConfig(post, [legacyConfig]);
  assert.equal(matched.id, "cfg-legacy");
});

test("IDを持つ設定がある場合、名称一致だけでは誤ってフォールバックしない", () => {
  const configWithIds = makeConfig({ id: "cfg-with-ids", forumId: "1", topicId: "1", name: "公用車予約キャンセル周知用" });
  // post のIDはconfigWithIdsと一致しない
  const post = makePost({ roomId: "8", topicId: "2319" });

  const matched = findMatchingTopicConfig(post, [configWithIds]);
  assert.equal(matched, null);
});

test("対象外のforumId・topicIdの投稿は一致しない", () => {
  const config = makeConfig({ forumId: "1", topicId: "1" });
  const post = makePost({ roomId: "99", topicId: "99", topicName: "一致しないはず" });
  const matched = findMatchingTopicConfig(post, [config]);
  assert.equal(matched, null);
});

test("matchPostsToTopicConfigsは一致しない投稿を除外する", () => {
  const config = makeConfig();
  const matchedPost = makePost();
  const unmatchedPost = makePost({ roomId: "999", topicId: "999", topicName: "対象外" });

  const pairs = matchPostsToTopicConfigs([matchedPost, unmatchedPost], [config]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].post, matchedPost);
  assert.equal(pairs[0].config.id, "cfg-1");
});
