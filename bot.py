#!/usr/bin/env python3
"""
NEPSE TMS Order Placing Bot
============================
Attaches to an already-open Chrome browser (with remote debugging enabled),
waits until the configured target time with microsecond precision,
then places a buy/sell order on the NEPSE TMS platform as fast as possible.

PREREQUISITES:
  1. Launch Chrome with remote debugging:
       google-chrome --remote-debugging-port=9222

  2. Log in to your TMS portal manually.

  3. Navigate to the order placement page manually.

  4. Run this bot:
       source venv/bin/activate
       python bot.py

The bot will wait until the target time and then submit the order.
"""

import time
import sys
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import (
    WebDriverException,
    TimeoutException,
    NoSuchElementException,
)

from config import (
    SYMBOL,
    QUANTITY,
    PRICE,
    TARGET_HOUR,
    TARGET_MINUTE,
    TARGET_SECOND,
    CHROME_DEBUG_PORT,
    ORDER_TYPE,
)


# ─── TMS FORM ELEMENT LOCATORS ───────────────────────────────
# These are common selectors for NEPSE TMS order forms.
# If your TMS uses different IDs, update them here.

# The stock symbol / scrip input field
FIELD_SYMBOL = (By.ID, "stockSymbol")

# Quantity input field
FIELD_QUANTITY = (By.ID, "quantity")

# Price input field
FIELD_PRICE = (By.ID, "price")

# Buy / Sell radio buttons or dropdown (adjust based on your TMS)
FIELD_ORDER_TYPE_BUY = (By.ID, "buyBtn")
FIELD_ORDER_TYPE_SELL = (By.ID, "sellBtn")

# The submit/place-order button
FIELD_SUBMIT = (By.ID, "submitButton")

# ──────────────────────────────────────────────────────────────


def print_banner():
    """Print a nice startup banner."""
    print("=" * 60)
    print("       NEPSE TMS ORDER PLACING BOT")
    print("=" * 60)
    print(f"  Symbol   : {SYMBOL}")
    print(f"  Quantity : {QUANTITY}")
    print(f"  Price    : Rs. {PRICE}")
    print(f"  Type     : {ORDER_TYPE.upper()}")
    print(f"  Target   : {TARGET_HOUR:02d}:{TARGET_MINUTE:02d}:{TARGET_SECOND:02d}")
    print(f"  Debug    : localhost:{CHROME_DEBUG_PORT}")
    print("=" * 60)


def attach_to_browser():
    """
    Attach Selenium to an already-open Chrome browser that was
    launched with --remote-debugging-port=9222.
    """
    options = Options()
    options.add_experimental_option("debuggerAddress", f"127.0.0.1:{CHROME_DEBUG_PORT}")

    try:
        driver = webdriver.Chrome(options=options)
    except WebDriverException as e:
        print("\n❌ FAILED to attach to Chrome browser!")
        print("   Make sure Chrome is running with remote debugging:")
        print(f"   google-chrome --remote-debugging-port={CHROME_DEBUG_PORT}")
        print(f"\n   Error: {e}")
        sys.exit(1)

    print(f"\n✅ Attached to browser successfully!")
    print(f"   Current page: {driver.current_url}")
    print(f"   Page title  : {driver.title}")
    return driver


def precise_wait_until_target():
    """
    Wait until the target time with microsecond precision.

    Strategy:
      1. Coarse sleep (time.sleep) until 1 second before target.
         This prevents high CPU usage during the long wait.
      2. Busy-wait (tight loop) for the final second.
         This gives microsecond-level precision for order placement.
    """
    now = datetime.now()
    target = now.replace(
        hour=TARGET_HOUR,
        minute=TARGET_MINUTE,
        second=TARGET_SECOND,
        microsecond=0,
    )

    # If the target time has already passed today
    if now >= target:
        print(f"\n⚠️  Target time {TARGET_HOUR:02d}:{TARGET_MINUTE:02d}:{TARGET_SECOND:02d} "
              f"has already passed today ({now.strftime('%H:%M:%S')}).")
        response = input("   Place order immediately? (y/n): ").strip().lower()
        if response == 'y':
            print("   Placing order NOW...")
            return
        else:
            print("   Exiting. Run the bot again before the target time.")
            sys.exit(0)

    remaining = (target - now).total_seconds()
    print(f"\n⏳ Waiting for {TARGET_HOUR:02d}:{TARGET_MINUTE:02d}:{TARGET_SECOND:02d}...")
    print(f"   Time remaining: {remaining:.1f} seconds ({remaining/60:.1f} minutes)")

    # Phase 1: Coarse sleep until 1 second before target
    while True:
        remaining = (target - datetime.now()).total_seconds()
        if remaining <= 1.0:
            break
        if remaining > 60:
            # Print countdown every 30 seconds for long waits
            mins = int(remaining // 60)
            secs = int(remaining % 60)
            print(f"   ⏳ {mins}m {secs}s remaining...", end="\r")
            time.sleep(10)
        elif remaining > 5:
            print(f"   ⏳ {remaining:.1f}s remaining...", end="\r")
            time.sleep(0.5)
        else:
            # Last 5 seconds: sleep in smaller intervals
            print(f"   🔥 {remaining:.2f}s remaining...", end="\r")
            time.sleep(0.05)

    # Phase 2: Busy-wait the final second for maximum precision
    print("\n   🚀 Final countdown — busy-waiting for precision...")
    while datetime.now() < target:
        pass  # tight loop, no sleep — maximum precision

    print(f"   ✅ TARGET TIME REACHED: {datetime.now().strftime('%H:%M:%S.%f')}")


def fast_fill(driver, wait, locator, value):
    """Clear a field and fill it as fast as possible using JavaScript."""
    try:
        el = wait.until(EC.presence_of_element_located(locator))
        # Use JavaScript for speed — faster than send_keys
        driver.execute_script(
            "arguments[0].value = arguments[1]; "
            "arguments[0].dispatchEvent(new Event('input', {bubbles: true})); "
            "arguments[0].dispatchEvent(new Event('change', {bubbles: true}));",
            el,
            str(value),
        )
    except TimeoutException:
        print(f"   ❌ Could not find element: {locator}")
        raise
    except Exception as e:
        print(f"   ❌ Error filling {locator}: {e}")
        raise


def place_order(driver):
    """
    Fill the order form and submit it.
    Uses JavaScript-based value setting for maximum speed.
    """
    wait = WebDriverWait(driver, 3)

    print(f"\n🚀 Placing {ORDER_TYPE.upper()} order...")

    try:
        # Step 1: Select order type (buy/sell) if applicable
        try:
            if ORDER_TYPE.lower() == "buy":
                buy_btn = driver.find_element(*FIELD_ORDER_TYPE_BUY)
                buy_btn.click()
            elif ORDER_TYPE.lower() == "sell":
                sell_btn = driver.find_element(*FIELD_ORDER_TYPE_SELL)
                sell_btn.click()
        except NoSuchElementException:
            # Some TMS forms don't have separate buy/sell buttons
            pass

        # Step 2: Fill symbol
        fast_fill(driver, wait, FIELD_SYMBOL, SYMBOL)

        # Step 3: Fill quantity
        fast_fill(driver, wait, FIELD_QUANTITY, QUANTITY)

        # Step 4: Fill price
        fast_fill(driver, wait, FIELD_PRICE, PRICE)

        # Step 5: Submit the order
        submit_btn = wait.until(EC.element_to_be_clickable(FIELD_SUBMIT))
        submit_btn.click()

        print(f"   [{datetime.now().strftime('%H:%M:%S.%f')}] ✅ Order submitted!")
        return True

    except TimeoutException as e:
        print(f"\n   ❌ TIMEOUT: Could not find a form element within 3 seconds.")
        print(f"      Make sure you are on the TMS order page.")
        print(f"      Error: {e}")
        return False
    except Exception as e:
        print(f"\n   ❌ ERROR placing order: {e}")
        return False


def verify_page(driver):
    """
    Quick check that the browser is on a TMS-like page.
    This is a basic heuristic — it just checks the URL and title.
    """
    url = driver.current_url.lower()
    title = driver.title.lower()

    # Common TMS URL patterns
    tms_indicators = ["tms", "trade", "nepse", "order", "meroshare"]

    is_tms = any(ind in url or ind in title for ind in tms_indicators)

    if not is_tms:
        print(f"\n⚠️  WARNING: The current page doesn't look like a TMS page!")
        print(f"   URL  : {driver.current_url}")
        print(f"   Title: {driver.title}")
        print(f"   Please navigate to the order placement page.")
        response = input("   Continue anyway? (y/n): ").strip().lower()
        if response != 'y':
            sys.exit(0)
    else:
        print(f"   ✅ TMS page detected.")


# ─── MAIN ─────────────────────────────────────────────────────
if __name__ == "__main__":
    print_banner()

    # Step 1: Attach to browser
    driver = attach_to_browser()

    # Step 2: Basic page verification
    verify_page(driver)

    # Step 3: Wait for the target time
    precise_wait_until_target()

    # Step 4: Place the order
    ts_before = datetime.now()
    success = place_order(driver)
    ts_after = datetime.now()

    # Step 5: Report results
    ms_taken = (ts_after - ts_before).total_seconds() * 1000
    print("\n" + "=" * 60)
    if success:
        print(f"  ⚡ Order placed in {ms_taken:.1f}ms after target time")
        print(f"  ⏱️  Submitted at: {ts_after.strftime('%H:%M:%S.%f')}")
    else:
        print(f"  ❌ Order placement FAILED after {ms_taken:.1f}ms")
    print("=" * 60)
