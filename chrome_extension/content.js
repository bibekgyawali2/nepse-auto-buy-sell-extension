/**
 * NEPSE TMS Auto Order — Content Script
 *
 * Runs on the TMS page. When it receives a "placeOrder" message:
 *  1. Busy-waits until the exact target time (microsecond precision).
 *  2. Fills the order form using JavaScript DOM manipulation (fastest method).
 *  3. Clicks submit.
 *  4. Reports the result back to the background script.
 */

(() => {
  // Prevent double-injection
  if (window.__nepseAutoOrderInjected) return;
  window.__nepseAutoOrderInjected = true;

  console.log("[NEPSE Bot] Content script loaded on:", window.location.href);

  // ─── MESSAGE LISTENER ──────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action !== "placeOrder") return;

    const config = msg.config;
    console.log("[NEPSE Bot] Received order command:", config);

    // Execute the order flow
    executeOrder(config);

    sendResponse({ status: "executing" });
    return true;
  });

  // ─── EXECUTE ORDER ─────────────────────────────────────────

  async function executeOrder(config) {
    try {
      // Step 0: Ensure Correct Session and Buy/Sell Mode
      setupCorrectState(config);

      // Step 0.5: Pre-fill the Symbol and ensure the dropdown is clicked
      // Doing this gives Angular time to fetch the lot size / tick bounds from the API.
      const boundsLoaded = await preFillSymbolAndFetchBounds(config);
      if (!boundsLoaded) {
        console.warn("[NEPSE Bot] Warning: Stock bounds (LTP) might not have loaded.");
      }

      // Step 0.6: Fill Qty and Price AFTER the symbol bounds have loaded!
      // (Angular clears these fields when a new symbol is selected)
      await new Promise(r => setTimeout(r, 15)); // Let Angular finish its internal reset (fast 15ms yield)
      fillQuantityAndPrice(config);
      await new Promise(r => setTimeout(r, 15)); // Let Angular update its validation state for Qty/Price

      // Step 0.7: Small delay to let Angular process the field values
      await new Promise(r => setTimeout(r, 100));

      // Step 1: Precise wait until target time (bypass if instant)
      if (!config.instant) {
        preciseWait(config.targetHour, config.targetMin, config.targetSec);
      } else {
        console.log("[NEPSE Bot] Instant mode — bypassing wait.");
      }

      // Step 2: Click submit via main world injection
      const tsBefore = performance.now();
      
      clickSubmitViaMainWorld(config);

      const tsAfter = performance.now();
      const timeTaken = (tsAfter - tsBefore).toFixed(1);
      const now = new Date();

      console.log(`[NEPSE Bot] ✅ Order placed in ${timeTaken}ms at ${now.toLocaleTimeString()}.${now.getMilliseconds()}`);

      // Report success
      chrome.runtime.sendMessage({
        action: "orderResult",
        result: {
          success: true,
          symbol: config.symbol,
          quantity: config.quantity,
          price: config.price,
          orderType: config.orderType,
          timeTaken: timeTaken,
          timestamp: now.toISOString(),
        },
      });
    } catch (err) {
      console.error("[NEPSE Bot] ❌ Order failed:", err);
      chrome.runtime.sendMessage({
        action: "orderResult",
        result: {
          success: false,
          error: err.message || String(err),
        },
      });
    }
  }

  // ─── FILL FIELDS ────────────────────────────────────────────

  function fillQuantityAndPrice(config) {
    const qtySel = config.selQuantity || "input[formcontrolname='quantity']";
    const priceSel = config.selPrice || "input[formcontrolname='price']";

    fastFill(qtySel, String(config.quantity));
    fastFill(priceSel, String(config.price));
  }

  // ─── SUBMIT ORDER VIA ENTER KEY ─────────────────────────────

  /**
   * Submit the form by focusing a form field (price) and pressing Enter.
   * This is the most reliable way to submit on NEPSE TMS because:
   *  - Angular keeps the BUY button disabled ("-") even when fields are filled programmatically
   *  - But pressing Enter in a form field naturally triggers form submission
   *  - This bypasses Angular's button state management entirely
   */
  function clickSubmitViaMainWorld(config) {
    const priceSel = config.selPrice || "input[formcontrolname='price']";
    
    const injectedCode = `
      (function() {
        // Focus the price field and press Enter to submit the form
        const priceEl = document.querySelector("${priceSel}");
        if (priceEl) {
          priceEl.focus();
          
          // Dispatch Enter key events — this triggers Angular's form submission
          const enterDown = new KeyboardEvent("keydown", {
            key: "Enter", code: "Enter", keyCode: 13, which: 13,
            bubbles: true, cancelable: true
          });
          const enterPress = new KeyboardEvent("keypress", {
            key: "Enter", code: "Enter", keyCode: 13, which: 13,
            bubbles: true, cancelable: true
          });
          const enterUp = new KeyboardEvent("keyup", {
            key: "Enter", code: "Enter", keyCode: 13, which: 13,
            bubbles: true, cancelable: true
          });
          
          priceEl.dispatchEvent(enterDown);
          priceEl.dispatchEvent(enterPress);
          priceEl.dispatchEvent(enterUp);
          
          console.log("[NEPSE Bot] ✅ Enter key dispatched on price field to submit form.");
        } else {
          // Fallback: try quantity field
          const qtyEl = document.querySelector("input[formcontrolname='quantity']");
          if (qtyEl) {
            qtyEl.focus();
            qtyEl.dispatchEvent(new KeyboardEvent("keydown", {
              key: "Enter", code: "Enter", keyCode: 13, which: 13,
              bubbles: true, cancelable: true
            }));
            qtyEl.dispatchEvent(new KeyboardEvent("keypress", {
              key: "Enter", code: "Enter", keyCode: 13, which: 13,
              bubbles: true, cancelable: true
            }));
            qtyEl.dispatchEvent(new KeyboardEvent("keyup", {
              key: "Enter", code: "Enter", keyCode: 13, which: 13,
              bubbles: true, cancelable: true
            }));
            console.log("[NEPSE Bot] ✅ Enter key dispatched on quantity field to submit form.");
          } else {
            console.error("[NEPSE Bot] ❌ No form field found to dispatch Enter on!");
          }
        }
      })();
    `;

    const scriptEl = document.createElement("script");
    scriptEl.textContent = injectedCode;
    document.body.appendChild(scriptEl);
    scriptEl.remove();

    console.log(`[NEPSE Bot] ${config.orderType.toUpperCase()} Submit via Enter key injected into main world.`);
  }

  // ─── PRECISE WAIT ──────────────────────────────────────────

  function preciseWait(hour, min, sec) {
    const target = new Date();
    target.setHours(hour, min, sec, 0);

    const now = new Date();
    if (now >= target) {
      console.log("[NEPSE Bot] Target time already passed — placing immediately.");
      return;
    }

    const remaining = target.getTime() - now.getTime();
    console.log(`[NEPSE Bot] Waiting ${(remaining / 1000).toFixed(1)}s until ${hour}:${min}:${sec}...`);

    // Phase 1: Coarse wait using setTimeout (non-blocking, saves CPU)
    // We sleep until 500ms before target, then busy-wait
    if (remaining > 500) {
      const coarseWait = remaining - 500;
      const start = Date.now();
      // Synchronous sleep via busy-wait (content scripts can't use async here for precision)
      while (Date.now() - start < coarseWait) {
        // Yield occasionally to prevent browser hang for long waits
        // For waits > 30s, we'll use a less aggressive loop
        if (coarseWait > 30000) {
          // Very long wait — check every 10ms
          const sleepUntil = Date.now() + 10;
          while (Date.now() < sleepUntil) { /* spin */ }
        }
      }
    }

    // Phase 2: Busy-wait the final 500ms for maximum precision
    while (new Date() < target) {
      // Tight loop — no yielding
    }

    console.log(`[NEPSE Bot] 🚀 Target time reached: ${new Date().toLocaleTimeString()}.${new Date().getMilliseconds()}`);
  }

  // ─── FILL FIELDS & VALIDATION ──────────────────────────────

  async function preFillSymbolAndFetchBounds(config) {
    const symbolSel = config.selSymbol || "input[formcontrolname='symbol']";
    const el = document.querySelector(symbolSel);
    
    // 1. Fill the symbol input and focus it (focus helps Angular's typeahead stay open)
    fastFill(symbolSel, config.symbol);
    if (el) el.focus();

    console.log("[NEPSE Bot] Symbol filled, waiting for typeahead dropdown...");

    // 2. Wait for and click the dropdown suggestion (Angular ngx-bootstrap typeahead)
    let dropdownItem = null;
    for (let i = 0; i < 150; i++) {
      // Find the specific button in the typeahead container that matches our symbol
      const items = Array.from(document.querySelectorAll("typeahead-container button.dropdown-item"));
      dropdownItem = items.find(btn => btn.textContent.toUpperCase().includes(config.symbol.toUpperCase()));
      
      if (dropdownItem) break;
      await new Promise(r => setTimeout(r, 10)); // Ultra-fast 10ms polling
    }
    
    if (dropdownItem) {
      console.log("[NEPSE Bot] Dropdown found, clicking:", dropdownItem.textContent.trim());
      dropdownItem.click();
    } else {
      console.warn("[NEPSE Bot] Dropdown item not found for", config.symbol);
      // Fallback: Dispatch Enter key
      if (el) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      }
    }

    console.log("[NEPSE Bot] Waiting for LTP to populate...");

    // 3. Wait for stock bounds details to populate (Check if 'LTP' has a number next to it)
    let ltpFound = false;
    for (let i = 0; i < 150; i++) {
      const match = document.body.innerText.match(/LTP\s*([\d\.,]+)/);
      if (match && match[1] && parseFloat(match[1]) > 0) {
        ltpFound = true;
        break;
      }
      await new Promise(r => setTimeout(r, 10)); // Ultra-fast 10ms polling
    }

    if (ltpFound) console.log("[NEPSE Bot] Stock bounds loaded properly!");
    return ltpFound;
  }

  /**
   * Fill a form field as fast as possible using direct DOM manipulation.
   * Dispatches input & change events so frameworks (React, Angular, etc.) pick it up.
   */
  function fastFill(selector, value) {
    const el = document.querySelector(selector);
    if (!el) {
      throw new Error(`Form field not found: "${selector}". Open DevTools (F12) on your TMS page and find the correct selector.`);
    }

    // Try using React/Angular setter if present (for framework-managed inputs)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    // Dispatch events to notify frameworks
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // ─── SETUP STATE ───────────────────────────────────────────

  function setupCorrectState(config) {
    console.log("[NEPSE Bot] Setting up state: Continuous Session, " + config.orderType.toUpperCase() + " Mode");
    
    try {
      // 1. Ensure CONTINUOUS session is selected
      // Based on TMS layout, Continuous is the first label
      const continuousLabel = document.querySelector("label.order__options--lab:nth-of-type(1)");
      if (continuousLabel) {
        const input = continuousLabel.querySelector("input");
        if (input && !input.checked) {
          console.log("[NEPSE Bot] Switching to CONTINUOUS session...");
          continuousLabel.click();
        }
      } else {
        // Fallback: look for label containing text 'CONTINUOUS'
        const labels = Array.from(document.querySelectorAll("label"));
        const fallbackLabel = labels.find(l => l.textContent.trim().toUpperCase().includes("CONTINUOUS"));
        if (fallbackLabel) {
          const input = fallbackLabel.querySelector("input");
          if (input && !input.checked) fallbackLabel.click();
        }
      }

      // 2. Ensure the correct BUY/SELL mode is active
      const isBuyTarget = config.orderType.toLowerCase() === "buy";
      const buyLabel = document.querySelector("label.order__options--buy");
      const sellLabel = document.querySelector("label.order__options--sell");
      
      const optionsBar = document.querySelector(".order__options");
      let currentModeIsSell = false;
      
      if (optionsBar) {
        // Red background implies SELL mode
        const bgColor = window.getComputedStyle(optionsBar).backgroundColor;
        if (bgColor.includes("255, 51, 51") || bgColor.includes("220, 53, 69")) {
          currentModeIsSell = true;
        }
      } else {
        // Fallback: check submit button
        const submitBtn = document.querySelector("button[type='submit']");
        if (submitBtn && submitBtn.textContent.trim().toUpperCase().includes("SELL")) {
           currentModeIsSell = true;
        }
      }

      const currentModeIsBuy = !currentModeIsSell;

      if (isBuyTarget && currentModeIsSell) {
        console.log("[NEPSE Bot] Switching to BUY mode...");
        if (buyLabel) buyLabel.click();
        else {
           const fallbackBuy = Array.from(document.querySelectorAll("label")).find(l => l.textContent.trim().toUpperCase() === "BUY");
           if (fallbackBuy) fallbackBuy.click();
        }
      } else if (!isBuyTarget && currentModeIsBuy) {
        console.log("[NEPSE Bot] Switching to SELL mode...");
        if (sellLabel) sellLabel.click();
        else {
           const fallbackSell = Array.from(document.querySelectorAll("label")).find(l => l.textContent.trim().toUpperCase() === "SELL");
           if (fallbackSell) fallbackSell.click();
        }
      }
    } catch (e) {
      console.error("[NEPSE Bot] Error setting up order state:", e);
    }
  }
})();
