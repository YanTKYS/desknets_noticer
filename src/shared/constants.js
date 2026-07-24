// 拡張機能全体で共有する定数定義。

export const EXTENSION_NAME = "desknet's noticer";

// 監視対象トピック（トピック名で完全一致判定を行う）。
// 初期状態はすべてOFF。
export const DEFAULT_TOPICS = [
  { name: "公用車キャンセル周知用", enabled: false },
  { name: "会議室キャンセル周知用", enabled: false }
];

export const CHECK_INTERVAL_MINUTES_OPTIONS = [3, 5, 10];
export const DEFAULT_CHECK_INTERVAL_MINUTES = 5;

export const ALARM_NAME = "desknets-noticer-check";

export const MAX_NOTIFICATION_HISTORY = 500;

// 1回の確認で新規投稿が何件までなら個別通知にするか。
export const INDIVIDUAL_NOTIFICATION_LIMIT = 3;

export const NOTIFICATION_BODY_MIN_LENGTH = 80;
export const NOTIFICATION_BODY_MAX_LENGTH = 120;

// ポップアップ／設定画面に表示する状態種別。
export const STATUS = {
  NOT_CONFIGURED: "NOT_CONFIGURED",
  AWAITING_FIRST_CHECK: "AWAITING_FIRST_CHECK",
  OK: "OK",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  CONNECTION_FAILED: "CONNECTION_FAILED",
  UNEXPECTED_PAGE: "UNEXPECTED_PAGE",
  LAST_CHECK_ERROR: "LAST_CHECK_ERROR",
  CHECKING: "CHECKING"
};

// 利用者向け表示文言（色だけに依存しないよう文字列で判別できるようにする）。
export const STATUS_LABELS = {
  [STATUS.NOT_CONFIGURED]: "未設定",
  [STATUS.AWAITING_FIRST_CHECK]: "初回確認待ち",
  [STATUS.OK]: "正常",
  [STATUS.AUTH_REQUIRED]: "desknet's NEOへのログインが必要です",
  [STATUS.CONNECTION_FAILED]: "接続できません",
  [STATUS.UNEXPECTED_PAGE]: "画面構造を認識できません",
  [STATUS.LAST_CHECK_ERROR]: "最終確認でエラー",
  [STATUS.CHECKING]: "確認中"
};

// 開発者向けエラーコード（利用者向けメッセージとは分離する）。
export const ERROR_CODES = {
  NOT_CONFIGURED: "NOT_CONFIGURED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  CONNECTION_FAILED: "CONNECTION_FAILED",
  UNEXPECTED_PAGE: "UNEXPECTED_PAGE",
  PARSER_FAILED: "PARSER_FAILED",
  PERMISSION_DENIED: "PERMISSION_DENIED"
};

export const STORAGE_KEYS = {
  SETTINGS: "settings",
  NOTIFICATION_HISTORY: "notificationHistory",
  RUNTIME_STATE: "runtimeState"
};

export const PARSER_MODE = {
  IDENTIFIER: "identifier",
  URL_PARAMS: "url-params",
  DATA_ATTRIBUTES: "data-attributes",
  LABEL_TEXT: "label-text",
  CSS_CLASS: "css-class",
  UNKNOWN: "unknown"
};
