import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

import { parseNewArrivals } from "../src/desknets/forum-parser.js";
import { detectPageState } from "../src/desknets/authentication-detector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(fileName) {
  const html = readFileSync(path.join(__dirname, "fixtures", fileName), "utf-8");
  const dom = new JSDOM(html);
  return dom.window.document;
}

const ENABLED_TOPICS = ["公用車キャンセル周知用", "会議室キャンセル周知用"];
const BASE_URL = "https://groupware.example.local/";

test("対象トピックの投稿を取得できる", () => {
  const doc = loadFixture("new-arrivals-with-ids.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const topicNames = result.matchedPosts.map((post) => post.topicName);
  assert.ok(topicNames.includes("公用車キャンセル周知用"));
  assert.ok(topicNames.includes("会議室キャンセル周知用"));
});

test("対象外トピックを除外できる", () => {
  const doc = loadFixture("new-arrivals-with-ids.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const topicNames = result.matchedPosts.map((post) => post.topicName);
  assert.ok(!topicNames.includes("お知らせ雑談"));
});

test("投稿者名を取得できる", () => {
  const doc = loadFixture("new-arrivals-with-ids.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.matchedPosts.find((p) => p.postId === "1001");
  assert.equal(post.author, "サンプル部 サンプル一郎");
});

test("投稿日時を取得できる", () => {
  const doc = loadFixture("new-arrivals-with-ids.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.matchedPosts.find((p) => p.postId === "1001");
  assert.equal(post.postedAt, "2026-07-24 09:15");
});

test("投稿本文を取得できる", () => {
  const doc = loadFixture("new-arrivals-with-ids.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.matchedPosts.find((p) => p.postId === "1001");
  assert.match(post.bodyPreview, /公用車予約をキャンセル/);
});

test("トピックURLを取得できる", () => {
  const doc = loadFixture("new-arrivals-with-ids.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.matchedPosts.find((p) => p.postId === "1001");
  assert.ok(post.url.startsWith("https://groupware.example.local/"));
});

test("複数投稿を取得できる", () => {
  const doc = loadFixture("new-arrivals-with-ids.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  assert.ok(result.matchedPosts.length >= 3);
});

test("一部項目が欠落しても全体が停止しない", () => {
  const doc = loadFixture("new-arrivals-with-ids.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const partialPost = result.matchedPosts.find((p) => p.postId === "1004");
  assert.ok(partialPost);
  assert.equal(partialPost.author, null);
  assert.equal(partialPost.postedAt, null);
  assert.ok(result.matchedPosts.length >= 3);
});

test("ログイン画面を新着情報として扱わない", () => {
  const doc = loadFixture("login-page.html");
  const state = detectPageState(doc);
  assert.equal(state.state, "auth_required");
});

test("想定外HTMLを正常結果として扱わない", () => {
  const doc = loadFixture("unexpected-page.html");
  const state = detectPageState(doc);
  assert.equal(state.state, "unexpected_page");
});

test("HTML内のスクリプトやタグを通知文に混入させない", () => {
  const doc = loadFixture("new-arrivals-with-script.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.matchedPosts.find((p) => p.postId === "2001");
  assert.ok(post);
  assert.ok(!post.bodyPreview.includes("<script"));
  assert.ok(!post.bodyPreview.includes("alert("));
});

test("投稿IDがない場合も安定した識別に足る情報を取得できる（ラベル文字列方式）", () => {
  const doc = loadFixture("new-arrivals-no-ids.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  assert.equal(result.matchedPosts.length, 2);

  const post = result.matchedPosts.find((p) => p.topicName === "公用車キャンセル周知用");
  assert.equal(post.postId, null);
  assert.equal(post.roomName, "総務課会議室");
  assert.equal(post.author, "サンプル部 サンプル花子");
  assert.match(post.bodyPreview, /公用車予約をキャンセル/);

  // 同一内容から作った複合キー文字列が、実行のたびに同じ値になることを確認する
  // （新着判定の安定性の前提条件）。
  const first = `${post.roomName}|${post.topicName}|${post.author}|${post.postedAt}|${post.bodyPreview}|${post.url}`;
  const secondDoc = loadFixture("new-arrivals-no-ids.html");
  const secondResult = parseNewArrivals(secondDoc, ENABLED_TOPICS, BASE_URL);
  const secondPost = secondResult.matchedPosts.find((p) => p.topicName === "公用車キャンセル周知用");
  const second = `${secondPost.roomName}|${secondPost.topicName}|${secondPost.author}|${secondPost.postedAt}|${secondPost.bodyPreview}|${secondPost.url}`;
  assert.equal(first, second);
});
