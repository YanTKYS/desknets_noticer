import test from "node:test";
import assert from "node:assert/strict";

import { validateAndNormalizeUrl, isSameOrigin, toOriginPermissionPattern } from "../src/desknets/url-utils.js";

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
