import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, "..", "manifest.json");

test("manifest.jsonはJSONとして正しい構文である", () => {
  const raw = readFileSync(manifestPath, "utf-8");
  assert.doesNotThrow(() => JSON.parse(raw));
});

test("default_localeが存在しない", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.equal("default_locale" in manifest, false);
});

test("_localesディレクトリが無くても読み込めるよう、localeメッセージ構文(__MSG_*__)を使用していない", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const serialized = JSON.stringify(manifest);
  assert.equal(/__MSG_.+__/.test(serialized), false);
});
