import test from "node:test";
import assert from "node:assert/strict";

import { buildCompositeKeySource, sha256Hex, normalizeWhitespace } from "../src/shared/text-utils.js";

const basePost = {
  roomId: "8",
  topicId: "2319",
  topicName: "公用車予約キャンセル周知用",
  author: "テスト 太郎",
  postedAt: "07/24 15:14",
  bodyPreview: "予約日時：7月24日(金)15:10～16:00 テスト車両（白色）0000"
};

test("同じ投稿情報からは同じ複合キー文字列が作られる（重複通知防止の前提）", () => {
  const first = buildCompositeKeySource(basePost);
  const second = buildCompositeKeySource({ ...basePost });
  assert.equal(first, second);
});

test("同じトピックIDでも投稿者・日時・本文が変われば複合キーが変わる（新着として検知できる）", () => {
  const original = buildCompositeKeySource(basePost);
  const updated = buildCompositeKeySource({
    ...basePost,
    author: "テスト 花子",
    postedAt: "07/25 09:00",
    bodyPreview: "新しい投稿概要です。"
  });
  assert.notEqual(original, updated);
});

test("投稿IDが無くても、会議室ID・トピックID・トピック名・投稿者・日時・本文から安定したハッシュを作成できる", async () => {
  const postWithoutId = { ...basePost };
  const source1 = buildCompositeKeySource(postWithoutId);
  const source2 = buildCompositeKeySource(postWithoutId);
  const hash1 = await sha256Hex(source1);
  const hash2 = await sha256Hex(source2);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
});

test("複合キーは職員名や本文をそのまま連結するが、SHA-256ハッシュ化後は元の文字列を含まない", async () => {
  const source = buildCompositeKeySource(basePost);
  const hash = await sha256Hex(source);
  assert.ok(!hash.includes(basePost.author));
  assert.ok(!hash.includes(basePost.bodyPreview));
  // ハッシュは16進数64文字（SHA-256）であることを確認する。
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("normalizeWhitespaceは前後の空白と連続する空白・改行を単一の半角スペースに正規化する", () => {
  assert.equal(normalizeWhitespace("  a\n\n  b   c  "), "a b c");
});
