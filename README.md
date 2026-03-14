# NEPSE TMS Order Placing Bot

Automated order placement bot for NEPSE TMS using Selenium. Attaches to your existing Chrome browser session and places orders at exactly 11:00:00 AM with microsecond precision.

## Prerequisites

- Python 3.8+
- Google Chrome browser
- ChromeDriver (matching your Chrome version)

## Setup

```bash
# 1. Activate virtual environment
source venv/bin/activate

# 2. Dependencies are already installed (selenium)
```

## How to Use

### Step 1: Launch Chrome with Remote Debugging

Close all Chrome windows first, then launch Chrome with debugging enabled:

```bash
google-chrome --remote-debugging-port=9222
```

> **Note:** If Chrome is already running, you must close it completely first, then relaunch with the flag above.

### Step 2: Log in to TMS

1. In the Chrome window that opened, navigate to your broker's TMS portal
2. Log in with your credentials
3. Navigate to the **order placement page**

### Step 3: Configure the Bot

Edit `config.py` with your order details:

```python
SYMBOL = "NABIL"      # Stock symbol
QUANTITY = 10          # Number of shares
PRICE = 1500           # Price per share
TARGET_HOUR = 11       # Hour to place order (24h format)
TARGET_MINUTE = 0      # Minute
TARGET_SECOND = 0      # Second
ORDER_TYPE = "buy"     # "buy" or "sell"
```

### Step 4: Run the Bot

```bash
source venv/bin/activate
python bot.py
```

The bot will:
1. ✅ Attach to your Chrome browser
2. ✅ Verify you're on a TMS page
3. ⏳ Wait until exactly 11:00:00 AM
4. 🚀 Place the order in milliseconds

## Important Notes

- **You handle login & navigation** — the bot only fills form fields and clicks submit
- **Adjust element IDs** — If the bot can't find form fields, inspect your TMS page (F12) and update the locators in `bot.py`
- **Test first** — Run the bot after market hours to verify it can find all form elements
- **Speed** — Uses JavaScript injection instead of `send_keys` for faster form filling

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "FAILED to attach to Chrome" | Make sure Chrome is running with `--remote-debugging-port=9222` |
| "Could not find element" | Inspect the TMS page (F12) and update element IDs in `bot.py` |
| "Page doesn't look like TMS" | Navigate to the order page before running the bot |

## File Structure

```
nepse_orderplacing_bot/
├── venv/              # Python virtual environment
├── bot.py             # Main bot script
├── config.py          # Configuration (symbol, qty, price, time)
└── README.md          # This file
```
