/**
 * NEPSE TMS Auto Order — Popup Script
 * Handles UI, config storage, arming/disarming, and countdown display.
 */

// ─── DOM REFS ────────────────────────────────────────────────
const $id = (id) => document.getElementById(id);

const DOM = {
  statusBar: $id("status-bar"),
  statusIcon: $id("status-icon"),
  statusText: $id("status-text"),
  liveClock: $id("live-clock"),
  symbol: $id("symbol"),
  quantity: $id("quantity"),
  price: $id("price"),
  btnBuy: $id("btn-buy"),
  btnSell: $id("btn-sell"),
  btnContinuous: $id("btn-continuous"),
  btnPreopen: $id("btn-preopen"),
  targetHour: $id("target-hour"),
  targetMin: $id("target-min"),
  targetSec: $id("target-sec"),
  selSymbol: $id("sel-symbol"),
  selQuantity: $id("sel-quantity"),
  selPrice: $id("sel-price"),
  selSubmit: $id("sel-submit"),
  btnArm: $id("btn-arm"),
  btnInstant: $id("btn-instant"),
  btnDisarm: $id("btn-disarm"),
  countdownSection: $id("countdown-section"),
  countdown: $id("countdown"),
  resultSection: $id("result-section"),
  resultIcon: $id("result-icon"),
  resultText: $id("result-text"),
  resultDetail: $id("result-detail"),
  formSection: document.querySelector(".form-section"),
  selectorsSection: document.querySelector(".selectors-section"),
};

let orderType = "buy";
let sessionType = "continuous";
let clockInterval = null;
let countdownInterval = null;

// ─── LIVE CLOCK ──────────────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    DOM.liveClock.textContent = `${h}:${m}:${s}.${ms}`;
  }
  tick();
  clockInterval = setInterval(tick, 47); // ~21fps for smooth ms display
}

// ─── STATUS HELPERS ──────────────────────────────────────────
function setStatus(type, icon, text) {
  DOM.statusBar.className = `status-bar status-${type}`;
  DOM.statusIcon.textContent = icon;
  DOM.statusText.textContent = text;
}

// ─── ORDER TYPE TOGGLE ───────────────────────────────────────
DOM.btnBuy.addEventListener("click", () => {
  orderType = "buy";
  DOM.btnBuy.classList.add("active");
  DOM.btnSell.classList.remove("active");
});

DOM.btnSell.addEventListener("click", () => {
  orderType = "sell";
  DOM.btnSell.classList.add("active");
  DOM.btnBuy.classList.remove("active");
});

// ─── SESSION TYPE TOGGLE ─────────────────────────────────────
DOM.btnContinuous.addEventListener("click", () => {
  sessionType = "continuous";
  DOM.btnContinuous.classList.add("active");
  DOM.btnPreopen.classList.remove("active");
});

DOM.btnPreopen.addEventListener("click", () => {
  sessionType = "preopen";
  DOM.btnPreopen.classList.add("active");
  DOM.btnContinuous.classList.remove("active");
});

// ─── LOAD SAVED CONFIG ───────────────────────────────────────
function loadConfig() {
  chrome.storage.local.get(
    [
      "symbol", "quantity", "price", "orderType",
      "targetHour", "targetMin", "targetSec",
      "selSymbol", "selQuantity", "selPrice", "selSubmit",
      "armed", "lastResult",
    ],
    (data) => {
      if (data.symbol) DOM.symbol.value = data.symbol;
      if (data.quantity) DOM.quantity.value = data.quantity;
      if (data.price) DOM.price.value = data.price;
      if (data.orderType) {
        orderType = data.orderType;
        if (orderType === "sell") {
          DOM.btnSell.classList.add("active");
          DOM.btnBuy.classList.remove("active");
        }
      }
      if (data.targetHour !== undefined) DOM.targetHour.value = data.targetHour;
      if (data.targetMin !== undefined) DOM.targetMin.value = data.targetMin;
      if (data.targetSec !== undefined) DOM.targetSec.value = data.targetSec;
      
      if (data.sessionType) {
        sessionType = data.sessionType;
        if (sessionType === "preopen") {
          DOM.btnPreopen.classList.add("active");
          DOM.btnContinuous.classList.remove("active");
        }
      }

      // Selectors with defaults
      DOM.selSymbol.value = data.selSymbol || "input[formcontrolname='symbol']";
      DOM.selQuantity.value = data.selQuantity || "input[formcontrolname='quantity']";
      DOM.selPrice.value = data.selPrice || "input[formcontrolname='price']";
      DOM.selSubmit.value = data.selSubmit || "button[type='submit']";

      // Restore armed state
      if (data.armed) {
        showArmedState();
      }

      // Show last result if any
      if (data.lastResult) {
        showResult(data.lastResult);
      }
    }
  );
}

// ─── SAVE CONFIG ─────────────────────────────────────────────
function saveConfig() {
  const config = {
    symbol: DOM.symbol.value.trim().toUpperCase(),
    quantity: parseInt(DOM.quantity.value) || 0,
    price: parseFloat(DOM.price.value) || 0,
    orderType: orderType,
    sessionType: sessionType,
    targetHour: parseInt(DOM.targetHour.value) || 11,
    targetMin: parseInt(DOM.targetMin.value) || 0,
    targetSec: parseInt(DOM.targetSec.value) || 0,
    selSymbol: DOM.selSymbol.value.trim() || "input[formcontrolname='symbol']",
    selQuantity: DOM.selQuantity.value.trim() || "input[formcontrolname='quantity']",
    selPrice: DOM.selPrice.value.trim() || "input[formcontrolname='price']",
    selSubmit: DOM.selSubmit.value.trim() || "button[type='submit']",
  };
  chrome.storage.local.set(config);
  return config;
}

// ─── VALIDATION ──────────────────────────────────────────────
function validate() {
  const errors = [];
  if (!DOM.symbol.value.trim()) errors.push("Symbol is required");
  if (!DOM.quantity.value || parseInt(DOM.quantity.value) < 1) errors.push("Quantity must be ≥ 1");
  if (!DOM.price.value || parseFloat(DOM.price.value) < 1) errors.push("Price must be ≥ 1");
  return errors;
}

// ─── ARM ORDER ───────────────────────────────────────────────
DOM.btnArm.addEventListener("click", () => {
  const errors = validate();
  if (errors.length > 0) {
    setStatus("error", "❌", errors.join(". "));
    return;
  }

  const config = saveConfig();
  config.armed = true;
  chrome.storage.local.set({ armed: true, lastResult: null });

  // Send arm message to background
  chrome.runtime.sendMessage({ action: "arm", config });

  showArmedState();
});

// ─── INSTANT FIRE ────────────────────────────────────────────
DOM.btnInstant.addEventListener("click", () => {
  const errors = validate();
  if (errors.length > 0) {
    setStatus("error", "❌", errors.join(". "));
    return;
  }

  const config = saveConfig();
  config.instant = true;
  chrome.storage.local.set({ armed: true, lastResult: null });

  setStatus("firing", "⚡", `Firing instantly — ${DOM.symbol.value.toUpperCase()} × ${DOM.quantity.value} @ Rs.${DOM.price.value}`);

  DOM.btnArm.classList.add("hidden");
  DOM.btnInstant.classList.add("hidden");
  DOM.btnDisarm.classList.add("hidden"); // Optional: disable disarm since it's instant
  DOM.countdownSection.classList.add("hidden");
  DOM.resultSection.classList.add("hidden");
  DOM.formSection.classList.add("form-disabled");
  DOM.selectorsSection.classList.add("form-disabled");

  // Send arm message with instant flag to background
  chrome.runtime.sendMessage({ action: "arm", config });
});

// ─── DISARM ──────────────────────────────────────────────────
DOM.btnDisarm.addEventListener("click", () => {
  chrome.storage.local.set({ armed: false, lastResult: null });
  chrome.runtime.sendMessage({ action: "disarm" });

  showIdleState();
});

// ─── UI STATE MANAGEMENT ─────────────────────────────────────
function showArmedState() {
  setStatus("armed", "🔶", `Armed — ${DOM.symbol.value.toUpperCase()} × ${DOM.quantity.value} @ Rs.${DOM.price.value}`);

  DOM.btnArm.classList.add("hidden");
  DOM.btnInstant.classList.add("hidden");
  DOM.btnDisarm.classList.remove("hidden");
  DOM.countdownSection.classList.remove("hidden");
  DOM.resultSection.classList.add("hidden");
  DOM.formSection.classList.add("form-disabled");
  DOM.selectorsSection.classList.add("form-disabled");

  startCountdown();
}

function showIdleState() {
  setStatus("idle", "⏸️", "Idle — Configure & arm");

  DOM.btnArm.classList.remove("hidden");
  DOM.btnInstant.classList.remove("hidden");
  DOM.btnDisarm.classList.add("hidden");
  DOM.countdownSection.classList.add("hidden");
  DOM.resultSection.classList.add("hidden");
  DOM.formSection.classList.remove("form-disabled");
  DOM.selectorsSection.classList.remove("form-disabled");

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function showResult(result) {
  if (!result) return;

  DOM.resultSection.classList.remove("hidden");
  DOM.countdownSection.classList.add("hidden");

  if (result.success) {
    setStatus("success", "✅", "Order submitted successfully!");
    DOM.resultIcon.textContent = "✅";
    DOM.resultText.textContent = `${result.symbol} — ${result.orderType.toUpperCase()} Order Placed!`;
    DOM.resultDetail.textContent = `${result.quantity} shares @ Rs.${result.price} • ${result.timeTaken}ms`;
  } else {
    setStatus("error", "❌", "Order failed!");
    DOM.resultIcon.textContent = "❌";
    DOM.resultText.textContent = "Order Failed";
    DOM.resultDetail.textContent = result.error || "Unknown error";
  }

  DOM.btnArm.classList.remove("hidden");
  DOM.btnInstant.classList.remove("hidden");
  DOM.btnDisarm.classList.add("hidden");
  DOM.formSection.classList.remove("form-disabled");
  DOM.selectorsSection.classList.remove("form-disabled");

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// ─── COUNTDOWN ───────────────────────────────────────────────
function startCountdown() {
  function tick() {
    const now = new Date();
    const targetH = parseInt(DOM.targetHour.value) || 11;
    const targetM = parseInt(DOM.targetMin.value) || 0;
    const targetS = parseInt(DOM.targetSec.value) || 0;

    const target = new Date();
    target.setHours(targetH, targetM, targetS, 0);

    let diff = target.getTime() - now.getTime();

    if (diff <= 0) {
      DOM.countdown.textContent = "00:00:00.000";
      DOM.countdown.style.color = "var(--green)";

      // Check if result came in
      chrome.storage.local.get(["armed", "lastResult"], (data) => {
        if (data.lastResult) {
          showResult(data.lastResult);
        } else if (!data.armed) {
          showIdleState();
        }
      });
      return;
    }

    const hours = Math.floor(diff / 3600000);
    diff %= 3600000;
    const mins = Math.floor(diff / 60000);
    diff %= 60000;
    const secs = Math.floor(diff / 1000);
    const ms = diff % 1000;

    DOM.countdown.textContent =
      `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;

    // Change color when close
    if (hours === 0 && mins === 0 && secs < 10) {
      DOM.countdown.style.color = "var(--red)";
    } else if (hours === 0 && mins < 1) {
      DOM.countdown.style.color = "var(--orange)";
    } else {
      DOM.countdown.style.color = "var(--orange)";
    }
  }

  tick();
  countdownInterval = setInterval(tick, 47);
}

// ─── LISTEN FOR RESULTS FROM BACKGROUND ──────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "orderResult") {
    chrome.storage.local.set({ armed: false, lastResult: msg.result });
    showResult(msg.result);
  }
});

// ─── INIT ────────────────────────────────────────────────────
startClock();
loadConfig();
