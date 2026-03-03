/**
 * Nat-vigator Background Service Worker
 * - Handles extension icon click → toggle sidebar
 * - Proxies API calls for content script (content scripts can't make
 *   cross-origin fetches due to LinkedIn's CSP)
 */

const API_BASE = "https://sfgtm.vercel.app";

// ── Extension icon click → toggle sidebar ──
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  if (!tab.url?.match(/linkedin\.com\/(in|company)\//)) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "toggle" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch {
      // Tab not accessible
    }
  }
});

// ── API proxy for content script ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "api") {
    handleApiRequest(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message || "Network error" }));
    return true; // keep message channel open for async response
  }
});

async function handleApiRequest(msg) {
  const { method, path, body } = msg;
  const url = `${API_BASE}${path}`;

  const opts = {
    method: method || "GET",
    headers: {},
  };

  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = await res.json();

  return { ok: res.ok, status: res.status, data };
}
