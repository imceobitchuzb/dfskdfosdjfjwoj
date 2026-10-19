"""
Configuration settings for MT Trade Terminal & Telegram Bot.
"""
import os
import json

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "bot_config.json")

def load_dynamic_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_dynamic_config(data: dict):
    try:
        current = load_dynamic_config()
        current.update(data)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving dynamic config: {e}")

_dyn = load_dynamic_config()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8952375347:AAFoLVPEbA5ltLzj12OkBFWKHgBwmBGp4V8")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "golds1gnalwebuzbot")
TELEGRAM_WEBAPP_URL = _dyn.get("webapp_url", os.getenv("TELEGRAM_WEBAPP_URL", ""))

# 24/7 Market Scanner Settings
SCAN_ASSETS = ["XAUUSD", "BTCUSD", "EURUSD", "GBPUSD"]
SCAN_TIMEFRAMES = ["15m", "1h"]
SCAN_INTERVAL_SECONDS = 25
MIN_CONFIDENCE_THRESHOLD = 75  # Strict filter: only signals with 75%+ consensus
MIN_SCORE_THRESHOLD = 0.18    # Significant directional imbalance among 200+ indicators
SIGNAL_COOLDOWN_MINUTES = 30  # Cooldown per symbol to avoid spam
