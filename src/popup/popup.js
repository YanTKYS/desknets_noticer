import { getSettings } from "../storage/settings-store.js";
import { getRuntimeState, clearNewCountBadge } from "../storage/runtime-state-store.js";
import { validateAndNormalizeUrl, pickBestMatchingTab } from "../desknets/url-utils.js";
import { STATUS, STATUS_LABELS } from "../shared/constants.js";

const STATUS_ICON_CLASS = {
  [STATUS.OK]: "ok",
  [STATUS.CHECKING]: "neutral",
  [STATUS.NOT_CONFIGURED]: "neutral",
  [STATUS.AWAITING_FIRST_CHECK]: "neutral",
  [STATUS.AUTH_REQUIRED]: "warning",
  [STATUS.CONNECTION_FAILED]: "error",
  [STATUS.UNEXPECTED_PAGE]: "error",
  [STATUS.LAST_CHECK_ERROR]: "error"
};

const STATUS_ICON_SYMBOL = {
  ok: "●",
  neutral: "○",
  warning: "▲",
  error: "✕"
};

function formatDateTime(isoString) {
  if (!isoString) return "-";
  try {
    return new Date(isoString).toLocaleString("ja-JP");
  } catch {
    return isoString;
  }
}

async function render() {
  const [settings, runtimeState] = await Promise.all([getSettings(), getRuntimeState()]);

  const hasUrl = !!validateAndNormalizeUrl(settings.monitorUrl);
  const status = hasUrl ? runtimeState.status : STATUS.NOT_CONFIGURED;

  const iconClass = STATUS_ICON_CLASS[status] || "neutral";
  const statusIcon = document.getElementById("statusIcon");
  statusIcon.textContent = STATUS_ICON_SYMBOL[iconClass];
  statusIcon.className = `status-icon ${iconClass}`;

  document.getElementById("statusText").textContent = STATUS_LABELS[status] || status;
  document.getElementById("lastCheckedAt").textContent = formatDateTime(runtimeState.lastCheckedAt);

  const debugInfo = runtimeState.debugInfo;
  document.getElementById("lastResult").textContent = debugInfo
    ? `認識 ${debugInfo.recognizedCount}件 / 対象一致 ${debugInfo.matchedCount}件`
    : "-";
  document.getElementById("newCount").textContent = `${runtimeState.newCountSinceLastPopupOpen}件`;

  const anyTopicEnabled = settings.topics.some((topic) => topic.enabled);
  if (!anyTopicEnabled) {
    document.getElementById("statusText").textContent += "（監視対象トピックがすべてOFFです）";
  }
}

async function handleRunNow() {
  const button = document.getElementById("runNowButton");
  const errorEl = document.getElementById("popupError");
  errorEl.hidden = true;
  errorEl.textContent = "";
  button.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: "run-now" });
    if (!response || response.ok !== true) {
      errorEl.textContent = "確認処理でエラーが発生しました。";
      errorEl.hidden = false;
    }
  } catch (error) {
    console.error("[desknets_noticer] 今すぐ確認の呼び出しに失敗しました。", error);
    errorEl.textContent = "確認処理でエラーが発生しました。";
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
    await render();
  }
}

async function handleOpenForum() {
  const settings = await getSettings();
  const normalizedUrl = validateAndNormalizeUrl(settings.monitorUrl);
  if (!normalizedUrl) {
    await chrome.runtime.openOptionsPage();
    return;
  }

  const tabs = await chrome.tabs.query({});
  const existingTab = pickBestMatchingTab(tabs, normalizedUrl);

  if (existingTab) {
    // 既存タブを前面表示するだけで終わらせず、必ず設定済みの新着情報画面URLへ遷移させる。
    await chrome.tabs.update(existingTab.id, { url: normalizedUrl, active: true });
    if (existingTab.windowId != null) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: normalizedUrl });
  }
}

function handleOpenOptions() {
  chrome.runtime.openOptionsPage();
}

document.addEventListener("DOMContentLoaded", async () => {
  await clearNewCountBadge();
  await render();

  document.getElementById("runNowButton").addEventListener("click", handleRunNow);
  document.getElementById("openForumButton").addEventListener("click", handleOpenForum);
  document.getElementById("openOptionsButton").addEventListener("click", handleOpenOptions);
});
