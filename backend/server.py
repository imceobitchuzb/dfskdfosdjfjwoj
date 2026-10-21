"""
FastAPI web server for the free MT Trade Analysis & Signals terminal.
Integrated directly with MetaTrader 5 live market data.
"""
import os
import asyncio
from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from backend.signal_generator import signal_engine
from backend.market_data import market_feed
from backend.mt5_adapter import mt5_adapter
from backend.indicators import calculate_all_indicators
from backend.telegram_bot import telegram_bot
from backend.news_service import news_service
from backend.trade_tracker import trade_tracker

app = FastAPI(title="MT Trade Live Signals Terminal")

@app.on_event("startup")
async def startup_event():
    # Start 24/7 Telegram Signal Bot & Market Scanner
    asyncio.create_task(telegram_bot.start())

@app.on_event("shutdown")
async def shutdown_event():
    telegram_bot.stop()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

@app.get("/", response_class=HTMLResponse)
@app.get("/cabinet", response_class=HTMLResponse)
async def cabinet_page():
    index_file = os.path.join(TEMPLATES_DIR, "index.html")
    if not os.path.exists(index_file):
        index_file = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>MT Trade Terminal Index Not Found</h1>")

# MT5 Connection Endpoints
@app.get("/api/mt5/status")
async def get_mt5_status():
    return mt5_adapter.get_status()

@app.post("/api/mt5/reconnect")
async def post_mt5_reconnect():
    success = mt5_adapter.connect()
    status = mt5_adapter.get_status()
    return {"success": success, "status": status}

@app.get("/api/market/symbols")
async def get_market_symbols():
    status = mt5_adapter.get_status()
    return {
        "is_connected": status["is_connected"],
        "server": status["server"],
        "symbol_map": status["symbol_map"],
        "all_symbols": mt5_adapter.all_symbols[:100]
    }

@app.get("/api/market/tick")
async def get_market_tick(symbol: str = Query("XAUUSD")):
    tick = mt5_adapter.get_tick(symbol)
    if not tick:
        raise HTTPException(status_code=404, detail=f"Тик для {symbol} пока недоступен. Проверьте статус MT5.")
    return tick

@app.get("/api/market/candles")
async def get_market_candles(
    symbol: str = Query("XAUUSD"),
    tf: str = Query("15m"),
    limit: int = Query(100, ge=10, le=500)
):
    candles, meta = mt5_adapter.get_candles(symbol, tf, limit)
    return {
        "symbol": symbol,
        "timeframe": tf,
        "candles": candles,
        "meta": meta
    }

# Terminal & User Config
@app.get("/api/me")
async def get_me():
    status = mt5_adapter.get_status()
    return {
        "id": f"MT5 PRO · {status['server'] or 'ONLINE'}",
        "market_open": not status.get("gold_tick", {}).get("is_stale", False),
        "cooldown": 0,
        "signal_wait": 0,
        "opens": None,
        "mt5_connected": status["is_connected"]
    }

@app.get("/api/config")
async def get_config():
    return {
        "register_url": "",
        "support_url": ""
    }

@app.get("/api/strategies")
async def get_strategies():
    return {
        "items": signal_engine.get_strategies()
    }

# Signal Generation
@app.post("/api/signal")
async def post_signal(req: Request):
    try:
        body = await req.json()
    except Exception:
        body = {}
    tf = body.get("tf", "15m")
    symbol = body.get("symbol", "XAUUSD")
    strategies = body.get("strategies", [])
    try:
        report = signal_engine.generate_signal(symbol=symbol, tf=tf, chosen_strategies=strategies)
        return report
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# 200+ Indicator Breakdown
@app.get("/api/analysis")
async def get_analysis(tf: str = "15m", symbol: str = "XAUUSD"):
    candles, meta = mt5_adapter.get_candles(symbol, tf, 90)
    if not candles:
        raise HTTPException(status_code=503, detail="Котировки MT5 недоступны. Проверьте подключение к терминалу.")
    curr_price = candles[-1][4]
    data = calculate_all_indicators(candles, curr_price)
    data["timeframe"] = tf
    data["updated"] = candles[-1][0] * 1000
    data["source"] = meta.get("source", "MetaTrader 5")
    data["broker_symbol"] = meta.get("broker_symbol", symbol)
    data["is_stale"] = meta.get("is_stale", False)
    return data

# Live Streaming Poll
@app.get("/api/live")
async def get_live(tf: str = "15m", symbol: str = "XAUUSD", trade: str = None, n: int = 15):
    return signal_engine.update_live_trade(symbol, tf, trade)

# Trade History
@app.get("/api/trades")
async def get_trades():
    return signal_engine.get_history()

@app.get("/api/trades/{trade_id}")
async def get_trade(trade_id: str):
    return signal_engine.get_trade_by_id(trade_id)

@app.post("/api/logout")
async def logout():
    return {"ok": True}

# Telegram Bot & 24/7 Scanner Endpoints
@app.get("/api/telegram/status")
async def get_telegram_status():
    return {
        "bot_username": telegram_bot.username,
        "is_running": telegram_bot.is_running,
        "subscribers_count": len(telegram_bot.subscribers),
        "webapp_url": telegram_bot.webapp_url,
        "last_signals": telegram_bot.last_signal_time
    }

@app.post("/api/telegram/set_url")
async def post_telegram_set_url(req: Request):
    data = await req.json()
    url = data.get("url", "").strip()
    if url.startswith("http"):
        telegram_bot.webapp_url = url
        from backend.config import save_dynamic_config
        save_dynamic_config({"webapp_url": url})
        await telegram_bot.setup_bot_menu()
        return {"ok": True, "webapp_url": url}
    raise HTTPException(status_code=400, detail="Invalid URL. Must start with http:// or https://")

@app.post("/api/telegram/scan_now")
async def post_telegram_scan_now():
    await telegram_bot.scan_market_cycle()
    return {"ok": True, "message": "Scan cycle executed."}

# News & Economic Calendar Endpoints
@app.get("/api/news")
async def get_market_news():
    return news_service.get_market_news_digest()

# Active Positions & Realized Stats Endpoints
@app.get("/api/trades/active")
async def get_active_positions():
    return {
        "items": trade_tracker.get_all_active_trades(),
        "stats": trade_tracker.get_stats()
    }

@app.get("/api/trades/stats")
async def get_trades_statistics():
    return trade_tracker.get_stats()
