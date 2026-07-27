// 拡張機能全体で共有する定数定義。

export const EXTENSION_NAME = "desknet's noticer";

export const MAX_TOPIC_NAME_LENGTH = 100;

// 通知対象トピックの最大登録件数。誤操作による大量追加や設定画面の可読性低下を防ぐための上限。
export const MAX_TOPICS = 20;

// 設定データの形式バージョン。旧形式（固定2件・トピック名のみ）からの移行判定に使う。
export const CURRENT_SETTINGS_VERSION = 2;

export const CHECK_INTERVAL_MINUTES_OPTIONS = [3, 5, 10];
export const DEFAULT_CHECK_INTERVAL_MINUTES = 5;

export const ALARM_NAME = "desknets-noticer-check";

export const MAX_NOTIFICATION_HISTORY = 500;

// 1回の確認で新規投稿が何件までなら個別通知にするか。
export const INDIVIDUAL_NOTIFICATION_LIMIT = 3;

export const NOTIFICATION_BODY_MIN_LENGTH = 80;
export const NOTIFICATION_BODY_MAX_LENGTH = 120;

// テスト通知の通知IDに付与する接頭辞。クリック時に「テスト通知である」と識別するために使う。
export const TEST_NOTIFICATION_ID_PREFIX = "desknets-noticer-test-";

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
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UNEXPECTED_ERROR: "UNEXPECTED_ERROR",
  DESKNETS_V6_PARSE_FAILED: "DESKNETS_V6_PARSE_FAILED",
  NO_TOPIC_LINKS_FOUND: "NO_TOPIC_LINKS_FOUND",
  TOPIC_URL_BUILD_FAILED: "TOPIC_URL_BUILD_FAILED",
  TEST_NOTIFICATION_FAILED: "TEST_NOTIFICATION_FAILED",
  NOTIFICATION_PERMISSION_UNAVAILABLE: "NOTIFICATION_PERMISSION_UNAVAILABLE",
  NOTIFICATION_API_ERROR: "NOTIFICATION_API_ERROR"
};

export const STORAGE_KEYS = {
  SETTINGS: "settings",
  NOTIFICATION_HISTORY: "notificationHistory",
  RUNTIME_STATE: "runtimeState"
};

export const PARSER_MODE = {
  // desknet's NEO v6.0 R1.0の実DOM（jforum-topiclink等）専用の解析方式。最優先で使用する。
  DESKNETS_V6: "desknets-v6",
  IDENTIFIER: "identifier",
  URL_PARAMS: "url-params",
  DATA_ATTRIBUTES: "data-attributes",
  LABEL_TEXT: "label-text",
  CSS_CLASS: "css-class",
  UNKNOWN: "unknown"
};
