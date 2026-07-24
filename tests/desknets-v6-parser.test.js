import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

import { parseNewArrivals } from "../src/desknets/forum-parser.js";
import { detectPageState } from "../src/desknets/authentication-detector.js";
import { PARSER_MODE } from "../src/shared/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(fileName) {
  const html = readFileSync(path.join(__dirname, "fixtures", fileName), "utf-8");
  const dom = new JSDOM(html);
  return dom.window.document;
}

const ENABLED_TOPICS = ["公用車予約キャンセル周知用", "会議室予約キャンセル周知用"];
const BASE_URL = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on";

test("desknet's v6専用パーサーがトピック候補を検出する（.jforum-topiclink）", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  assert.equal(result.parserMode, PARSER_MODE.DESKNETS_V6);
  assert.equal(result.topicLinkCount, 4);
});

test("最も近いtrを投稿単位として取得できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  assert.equal(result.rowCandidateCount, 4);
  assert.equal(result.recognizedCount, 4);
});

test("重複したtrを除外できる（同じ行に複数のトピックリンクがあっても1件として扱う）", () => {
  const html = `<!DOCTYPE html><html><body><table><tbody>
    <tr class="forum-unread unread">
      <th>
        <a class="jforum-forumlink" data-fid="1" title="重複テスト会議室" href="#cmd=forumtlist&fid=1&init=1">重複テスト会議室</a>
        <a class="jforum-topiclink" data-fid="1" data-tid="10" title="重複テストトピック" href="#cmd=forumalist&fid=1&tid=10&init=1">重複テストトピック</a>
        <a class="jforum-topiclink" data-fid="1" data-tid="10" title="重複テストトピック" href="#cmd=forumalist&fid=1&tid=10&init=1">重複テストトピック（別リンク）</a>
      </th>
    </tr>
  </tbody></table></body></html>`;
  const dom = new JSDOM(html);
  const result = parseNewArrivals(dom.window.document, ["重複テストトピック"], BASE_URL);
  assert.equal(result.topicLinkCount, 2);
  assert.equal(result.rowCandidateCount, 1);
  assert.equal(result.recognizedCount, 1);
});

test("会議室名をjforum-forumlinkのtitleから取得できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.posts.find((p) => p.topicId === "2319");
  assert.equal(post.roomName, "テスト会議室");
});

test("会議室IDをdata-fidから取得できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.posts.find((p) => p.topicId === "2319");
  assert.equal(post.roomId, "8");
});

test("トピック名をjforum-topiclinkのtitleから取得できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.posts.find((p) => p.topicId === "2319");
  assert.equal(post.topicName, "公用車予約キャンセル周知用");
});

test("トピックIDをdata-tidから取得できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.posts.find((p) => p.roomId === "9");
  assert.equal(post.topicId, "4471");
});

test("投稿概要を.forum-top-list-memoから取得できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.posts.find((p) => p.topicId === "4471");
  assert.match(post.bodyPreview, /第3会議室/);
});

test("<br>を含む本文が安全なテキストへ変換される（連続空白・改行が正規化される）", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.posts.find((p) => p.topicId === "2319");
  assert.match(post.bodyPreview, /予約日時：7月24日\(金\)15:10～16:00 テスト車両/);
  assert.ok(!post.bodyPreview.includes("\n"));
});

test("投稿者を.forum-top-list-name span[title]から取得できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.posts.find((p) => p.topicId === "2319");
  assert.equal(post.author, "テスト 太郎");
});

test("投稿日時を.forum-top-list-dateから取得できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.posts.find((p) => p.topicId === "2319");
  assert.equal(post.postedAt, "07/24 15:14");
});

test("投稿URLを正しく生成できる（ハッシュ部分がトピック表示用に置き換わる）", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const post = result.posts.find((p) => p.topicId === "2319");
  assert.equal(
    post.url,
    "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on#cmd=forumalist&fid=8&tid=2319&init=1"
  );
});

test("対象トピック名を完全一致で判定できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const matchedTopicNames = result.matchedPosts.map((p) => p.topicName);
  assert.ok(matchedTopicNames.includes("公用車予約キャンセル周知用"));
  assert.ok(matchedTopicNames.includes("会議室予約キャンセル周知用"));
});

test("対象外トピックを除外できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const matchedTopicNames = result.matchedPosts.map((p) => p.topicName);
  assert.ok(!matchedTopicNames.includes("お知らせ雑談"));
});

test("トピック名の前後空白のみ正規化し、部分一致や表記ゆれは吸収しない", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ["公用車予約キャンセル周知用ダミー"], BASE_URL);
  assert.equal(result.matchedCount, 0);
});

test("一部項目（投稿者・日時）が欠落しても全体が停止しない", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  const partialPost = result.posts.find((p) => p.topicId === "2320");
  assert.ok(partialPost);
  assert.equal(partialPost.author, null);
  assert.equal(partialPost.postedAt, null);
  assert.equal(result.recognizedCount, 4);
});

test("設定トピック名がHTML内に存在するかどうかを判定できる", () => {
  const doc = loadFixture("desknets-v6-new-arrivals.html");
  const foundResult = parseNewArrivals(doc, ["公用車予約キャンセル周知用"], BASE_URL);
  assert.equal(foundResult.topicNameFoundInHtml, true);

  const notFoundResult = parseNewArrivals(doc, ["絶対に存在しないトピック名"], BASE_URL);
  assert.equal(notFoundResult.topicNameFoundInHtml, false);
});

test("新着投稿が0件の画面はunexpected_pageではなくokと判定され、topicLinkCountが0になる", () => {
  const doc = loadFixture("desknets-v6-empty-new-arrivals.html");
  const state = detectPageState(doc);
  assert.equal(state.state, "ok");

  const result = parseNewArrivals(doc, ENABLED_TOPICS, BASE_URL);
  assert.equal(result.topicLinkCount, 0);
  assert.equal(result.recognizedCount, 0);
});
