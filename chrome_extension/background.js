/**
 * NEPSE TMS Auto Order — Background Service Worker
 *
 * Manages the timing loop. When armed:
 *  1. Creates a Chrome alarm to wake up ~2 seconds before target.
 *  2. On alarm fire, injects precise timing + order placement into the active tab.
 *
 * The actual order placement is done by the content script (content.js),
 * which has direct DOM access to the TMS page.
 */

const ALARM_NAME = "nepse-order-alarm";

// ─── ARM ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "arm") {
    const config = msg.config;
    chrome.storage.local.set({ armed: true, orderConfig: config, lastResult: null });

    if (config.instant) {
      console.log("[NEPSE Bot] Instant mode requested, firing immediately.");
      fireOrderOnActiveTab(config);
      sendResponse({ status: "armed_instant" });
      return true;
    }

    // Calculate delay until ~2 seconds before target
    const now = new Date();
    const target = new Date();
    target.setHours(config.targetHour, config.targetMin, config.targetSec, 0);

    let delayMs = target.getTime() - now.getTime() - 2000; // 2s before
    if (delayMs < 0) delayMs = 0;

    const delayMinutes = Math.max(delayMs / 60000, 0.01); // Chrome alarms need minutes, min ~0.6s

    // Clear any existing alarm
    chrome.alarms.clear(ALARM_NAME, () => {
      if (delayMinutes < 0.08) {
        // Less than about 5 seconds away — fire immediately via tab message
        console.log("[NEPSE Bot] Target is imminent, firing content script now...");
        fireOrderOnActiveTab(config);
      } else {
        // Set alarm
        chrome.alarms.create(ALARM_NAME, { delayInMinutes: delayMinutes });
        console.log(`[NEPSE Bot] Armed. Alarm in ${delayMinutes.toFixed(2)} minutes.`);
      }
    });

    sendResponse({ status: "armed" });
  }

  if (msg.action === "disarm") {
    chrome.alarms.clear(ALARM_NAME);
    chrome.storage.local.set({ armed: false });
    console.log("[NEPSE Bot] Disarmed.");
    sendResponse({ status: "disarmed" });
  }

  return true; // keep message channel open for async
});

// ─── ALARM HANDLER ───────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  console.log("[NEPSE Bot] Alarm fired! Preparing to place order...");

  chrome.storage.local.get(["armed", "orderConfig"], (data) => {
    if (!data.armed || !data.orderConfig) {
      console.log("[NEPSE Bot] Not armed or no config. Ignoring alarm.");
      return;
    }
    fireOrderOnActiveTab(data.orderConfig);
  });
});

// ─── FIRE ORDER ON ACTIVE TAB ────────────────────────────────
function fireOrderOnActiveTab(config) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      console.error("[NEPSE Bot] No active tab found!");
      broadcastResult({
        success: false,
        error: "No active tab found. Make sure the TMS page is open.",
      });
      return;
    }

    const tabId = tabs[0].id;
    console.log(`[NEPSE Bot] Sending order command to tab ${tabId}...`);

    // Send message to content script
    chrome.tabs.sendMessage(tabId, {
      action: "placeOrder",
      config: config,
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[NEPSE Bot] Content script error:", chrome.runtime.lastError.message);
        
        // Try injecting the content script and retry
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["content.js"],
        }, () => {
          if (chrome.runtime.lastError) {
            broadcastResult({
              success: false,
              error: "Could not reach the TMS page. " + chrome.runtime.lastError.message,
            });
            return;
          }
          // Retry after injection
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, {
              action: "placeOrder",
              config: config,
            });
          }, 200);
        });
      }
    });
  });
}

// ─── BROADCAST RESULT ────────────────────────────────────────
function broadcastResult(result) {
  chrome.storage.local.set({ armed: false, lastResult: result });
  chrome.runtime.sendMessage({ action: "orderResult", result });
}

// ─── LISTEN FOR RESULTS FROM CONTENT SCRIPT ──────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === "orderResult") {
    console.log("[NEPSE Bot] Order result received:", msg.result);
    chrome.storage.local.set({ armed: false, lastResult: msg.result });
    // Forward to popup if it's open
    try {
      chrome.runtime.sendMessage({ action: "orderResult", result: msg.result });
    } catch (e) {
      // Popup might not be open — that's fine
    }
  }
});
