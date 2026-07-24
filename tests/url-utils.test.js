import test from "node:test";
import assert from "node:assert/strict";

import {
  validateAndNormalizeUrl,
  isSameOrigin,
  toOriginPermissionPattern,
  extractHashParam,
  pickBestMatchingTab
} from "../src/desknets/url-utils.js";

test("httpとhttpsのURLは受け入れる", () => {
  assert.ok(validateAndNormalizeUrl("https://groupware.example.local/cgi-bin/x"));
  assert.ok(validateAndNormalizeUrl("http://groupware.example.local/cgi-bin/x"));
});

test("http/https以外のスキームは拒否する", () => {
  assert.equal(validateAndNormalizeUrl("ftp://groupware.example.local/"), null);
  assert.equal(validateAndNormalizeUrl("javascript:alert(1)"), null);
});

test("前後の空白を除去する", () => {
  const result = validateAndNormalizeUrl("  https://groupware.example.local/cgi-bin/x  ");
  assert.equal(result, "https://groupware.example.local/cgi-bin/x");
});

test("不正なURL文字列はnullを返す", () => {
  assert.equal(validateAndNormalizeUrl("not a url"), null);
  assert.equal(validateAndNormalizeUrl(""), null);
  assert.equal(validateAndNormalizeUrl(null), null);
});

test("末尾スラッシュの差異を正規化する", () => {
  const withSlash = validateAndNormalizeUrl("https://groupware.example.local/cgi-bin/x/");
  const withoutSlash = validateAndNormalizeUrl("https://groupware.example.local/cgi-bin/x");
  assert.equal(withSlash, withoutSlash);
});

test("ルートパスの末尾スラッシュは維持する", () => {
  const result = validateAndNormalizeUrl("https://groupware.example.local/");
  assert.equal(result, "https://groupware.example.local/");
});

test("同一オリジンかどうかを判定できる", () => {
  assert.ok(
    isSameOrigin(
      "https://groupware.example.local/cgi-bin/a",
      "https://groupware.example.local/cgi-bin/b"
    )
  );
  assert.ok(
    !isSameOrigin("https://groupware.example.local/a", "https://evil.example.com/a")
  );
});

test("オリジンの権限パターンを生成できる", () => {
  assert.equal(
    toOriginPermissionPattern("https://groupware.example.local/cgi-bin/x"),
    "https://groupware.example.local/*"
  );
});

test("ハッシュURLからfidを取得できる", () => {
  const url = new URL(
    "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumalist&fid=8&tid=2319&init=1"
  );
  assert.equal(extractHashParam(url, ["fid"]), "8");
});

test("同URLからtidを取得できる", () => {
  const url = new URL(
    "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumalist&fid=8&tid=2319&init=1"
  );
  assert.equal(extractHashParam(url, ["tid"]), "2319");
});

test("通常のクエリパラメーターとハッシュパラメーターを区別できる", () => {
  const url = new URL(
    "http://groupware.example.local/scripts/dneo/zforum.exe?fid=999#cmd=forumalist&fid=8&tid=2319"
  );
  // 通常のクエリパラメーター(searchParams)とハッシュパラメーターは別物であることを確認する。
  assert.equal(url.searchParams.get("fid"), "999");
  assert.equal(extractHashParam(url, ["fid"]), "8");
});

test("ハッシュが無いURLではnullを返す", () => {
  const url = new URL("http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist");
  assert.equal(extractHashParam(url, ["fid"]), null);
});

test("相対ハッシュURLを絶対URLへ変換できる（オリジン・パス・クエリを維持する）", () => {
  const base = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on";
  const href = "#cmd=forumalist&fid=8&tid=2319&init=1";
  const resolved = new URL(href, base).toString();
  assert.equal(
    resolved,
    "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on#cmd=forumalist&fid=8&tid=2319&init=1"
  );
});

test("設定URLと完全一致するタブを最優先で選ぶ", () => {
  const targetUrl = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumlist";
  const tabs = [
    { id: 1, url: "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumalist&fid=1&tid=2" },
    { id: 2, url: targetUrl }
  ];
  const tab = pickBestMatchingTab(tabs, targetUrl);
  assert.equal(tab.id, 2);
});

test("完全一致が無い場合はzforum.exeを開いている同一オリジンタブを選ぶ", () => {
  const targetUrl = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist#cmd=forumlist";
  const tabs = [
    { id: 1, url: "http://groupware.example.local/portal/top.html" },
    { id: 2, url: "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumalist&fid=1" }
  ];
  const tab = pickBestMatchingTab(tabs, targetUrl);
  assert.equal(tab.id, 2);
});

test("zforum.exeタブも完全一致タブも無い場合は同一オリジンの任意のタブを選ぶ", () => {
  const targetUrl = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist";
  const tabs = [{ id: 1, url: "http://groupware.example.local/portal/top.html" }];
  const tab = pickBestMatchingTab(tabs, targetUrl);
  assert.equal(tab.id, 1);
});

test("異なるオリジンのタブは選ばれない（該当なしの場合はnull）", () => {
  const targetUrl = "http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist";
  const tabs = [{ id: 1, url: "http://evil.example.com/scripts/dneo/zforum.exe" }];
  assert.equal(pickBestMatchingTab(tabs, targetUrl), null);
});
