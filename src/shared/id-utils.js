// 拡張機能内部の設定行を識別するためのID生成ユーティリティ。
// desknet's NEO側のID（fid・tid）とは無関係の、UIの追加・削除・更新・状態維持のためだけの識別子。

/**
 * 内部設定IDを生成する。crypto.randomUUID() が使える環境ではそれを使い、
 * 使えない環境（未対応ブラウザ等）ではフォールバックの一意文字列を生成する。
 * @returns {string}
 */
export function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `topic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
