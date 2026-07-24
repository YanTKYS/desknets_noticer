import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backgroundDir = path.join(__dirname, "..", "src", "background");

/**
 * ソース1行からJSDocコメント（@param {import("...")} のような型参照）を除いた
 * 実コードとして dynamic import() 呼び出しが含まれるかを判定する。
 * @param {string} line
 * @returns {boolean}
 */
function lineHasDynamicImportCall(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("*") || trimmed.startsWith("//")) return false;
  // `import(` の直後が文字列リテラルの開始であり、かつ `@param`/`@returns` 等の
  // JSDoc型注釈ではない実行コードのみを検出する。
  return /(^|[^.\w])import\s*\(/.test(line) && !line.includes("@param") && !line.includes("@returns");
}

test("service-worker.jsにdynamic import()が存在しない", () => {
  const filePath = path.join(backgroundDir, "service-worker.js");
  const content = readFileSync(filePath, "utf-8");
  const offendingLines = content.split("\n").filter(lineHasDynamicImportCall);
  assert.deepEqual(offendingLines, []);
});

test("background配下のすべてのファイルにdynamic import()が存在しない", () => {
  const files = ["service-worker.js", "alarm-manager.js", "notification-manager.js"];
  for (const fileName of files) {
    const content = readFileSync(path.join(backgroundDir, fileName), "utf-8");
    const offendingLines = content.split("\n").filter(lineHasDynamicImportCall);
    assert.deepEqual(offendingLines, [], `${fileName} contains a dynamic import() call`);
  }
});
