"""
24/7 Telegram Signal Bot, Trade Lifecycle Monitor & News Engine for MetaTrader 5.
Bot: @golds1gnalwebuzbot
Token: 8952375347:AAFoLVPEbA5ltLzj12OkBFWKHgBwmBGp4V8
"""
import os
import time
import json
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
import httpx

from backend.config import (
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_BOT_USERNAME,
    TELEGRAM_WEBAPP_URL,
    SCAN_ASSETS,
    SCAN_TIMEFRAMES,
    SCAN_INTERVAL_SECONDS,
    MIN_CONFIDENCE_THRESHOLD,
    MIN_SCORE_THRESHOLD,
    SIGNAL_COOLDOWN_MINUTES,
    save_dynamic_config,
    load_dynamic_config
)
from backend.mt5_adapter import mt5_adapter
from backend.indicators import calculate_all_indicators
from backend.smc import analyze_smc
from backend.trade_tracker import trade_tracker
from backend.news_service import news_service

logger = logging.getLogger("telegram_bot")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUBSCRIBERS_FILE = os.path.join(BASE_DIR, "backend", "subscribers.json")

class TelegramSignalBot:
    def __init__(self):
        self.token = TELEGRAM_BOT_TOKEN
        self.username = TELEGRAM_BOT_USERNAME
        self.api_url = f"https://api.telegram.org/bot{self.token}"
        self.subscribers: Dict[str, Dict[str, Any]] = self._load_subscribers()
        self.last_signal_time: Dict[str, float] = {}
        self.is_running = False
        self.client: Optional[httpx.AsyncClient] = None
        self.last_update_id = 0
        self.webapp_url = TELEGRAM_WEBAPP_URL

    def _load_subscribers(self) -> Dict[str, Dict[str, Any]]:
        if os.path.exists(SUBSCRIBERS_FILE):
            try:
                with open(SUBSCRIBERS_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load subscribers: {e}")
        return {}

    def _save_subscribers(self):
        try:
            with open(SUBSCRIBERS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.subscribers, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save subscribers: {e}")

    def add_subscriber(self, chat_id: int, user_info: dict) -> bool:
        cid = str(chat_id)
        is_new = cid not in self.subscribers
        self.subscribers[cid] = {
            "chat_id": chat_id,
            "username": user_info.get("username", ""),
            "first_name": user_info.get("first_name", ""),
            "subscribed_at": self.subscribers.get(cid, {}).get("subscribed_at", datetime.now().isoformat()),
            "last_active": datetime.now().isoformat()
        }
        self._save_subscribers()
        return is_new

    def remove_subscriber(self, chat_id: int):
        cid = str(chat_id)
        if cid in self.subscribers:
            del self.subscribers[cid]
            self._save_subscribers()

    async def api_call(self, method: str, payload: dict = None) -> Optional[dict]:
        if not self.client:
            self.client = httpx.AsyncClient(timeout=30.0)
        url = f"{self.api_url}/{method}"
        try:
            resp = await self.client.post(url, json=payload or {})
            data = resp.json()
            if not data.get("ok"):
                logger.warning(f"Telegram API {method} error: {data.get('description')}")
            return data
        except Exception as e:
            logger.error(f"Telegram API {method} exception: {e}")
            return None

    async def setup_bot_menu(self):
        """Configure Telegram Menu Button for Mini App"""
        dyn = load_dynamic_config()
        self.webapp_url = dyn.get("webapp_url", self.webapp_url)
        if self.webapp_url and self.webapp_url.startswith("https://"):
            menu_payload = {
                "menu_button": {
                    "type": "web_app",
                    "text": "📊 Терминал MT5",
                    "web_app": {"url": self.webapp_url}
                }
            }
            await self.api_call("setChatMenuButton", menu_payload)
            logger.info(f"Telegram Menu Web App configured: {self.webapp_url}")
        else:
            await self.api_call("setChatMenuButton", {"menu_button": {"type": "default"}})

    def get_reply_keyboard(self) -> dict:
        keyboard = [
            [{"text": "🎯 Получить сигнал прямо сейчас"}, {"text": "📊 Активные сделки"}],
            [{"text": "📰 Новости и прогноз рынка"}, {"text": "🏆 Статистика винрейта"}],
            [{"text": "🔍 Сканер рынка (4 актива)"}, {"text": "⚙️ Статус MT5"}]
        ]
        if self.webapp_url and self.webapp_url.startswith("https://"):
            keyboard.insert(0, [{"text": "📈 Открыть Терминал (Mini App)", "web_app": {"url": self.webapp_url}}])
        return {"keyboard": keyboard, "resize_keyboard": True}

    async def send_message(self, chat_id: int, text: str, reply_markup: dict = None):
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True
        }
        if reply_markup:
            payload["reply_markup"] = reply_markup
        return await self.api_call("sendMessage", payload)

    async def broadcast_message(self, text: str, reply_markup: dict = None):
        if not self.subscribers:
            logger.info("No subscribers registered to receive broadcast.")
            return
        logger.info(f"Broadcasting notification to {len(self.subscribers)} subscriber(s)...")
        tasks = []
        for cid in list(self.subscribers.keys()):
            tasks.append(self.send_message(int(cid), text, reply_markup))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def analyze_asset_setup(self, symbol: str, tf: str = "15m") -> Optional[Dict[str, Any]]:
        """
        Deep multi-indicator, multi-timeframe and SMC analysis.
        Includes special strict filters for Gold (XAUUSD).
        """
        candles, meta = mt5_adapter.get_candles(symbol, tf, 90)
        if not candles or len(candles) < 30:
            return None

        curr_price = candles[-1][4]
        digits = 2 if curr_price > 50 else (4 if curr_price > 2 else 5)

        # 1. ATR calculation
        highs = [c[2] for c in candles]
        lows = [c[3] for c in candles]
        closes = [c[4] for c in candles]
        trs = [max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1])) for i in range(1, len(candles))]
        atr = sum(trs[-14:]) / 14.0 if trs else (curr_price * 0.003)

        # 2. Indicator consensus & SMC structures
        analysis = calculate_all_indicators(candles, curr_price)
        smc = analyze_smc(candles, atr)

        score = analysis["score"]
        confidence = min(96, max(65, int(72 + abs(score) * 35)))

        # SMC confluence detection
        smc_reasons = []
        has_smc_confluence = False

        # FVG Check
        for gap in smc.get("fvg", []):
            if abs(curr_price - (gap["top"] + gap["bottom"]) / 2) <= 1.8 * atr:
                smc_reasons.append(f"Тест имбаланса FVG ({gap['type'].upper()} {gap['bottom']}–{gap['top']})")
                has_smc_confluence = True
                break

        # Order Block Check
        for ob in smc.get("ob", []):
            if abs(curr_price - (ob["top"] + ob["bottom"]) / 2) <= 1.8 * atr:
                smc_reasons.append(f"Реакция на институциональный Order Block ({ob['type'].upper()})")
                has_smc_confluence = True
                break

        # Liquidity Sweep Check
        if smc.get("liquidity", {}).get("swept"):
            last_sweep = smc["liquidity"]["swept"][-1]
            smc_reasons.append(f"Снятие пула ликвидности {last_sweep.get('kind', '')} ({last_sweep.get('price', '')})")
            has_smc_confluence = True

        # Gold-Specific Multi-Timeframe (MTF) & Spread Filter
        if symbol == "XAUUSD":
            # Check H1 higher timeframe alignment
            h1_candles, _ = mt5_adapter.get_candles(symbol, "1h", 40)
            if h1_candles and len(h1_candles) >= 15:
                h1_closes = [c[4] for c in h1_candles]
                h1_ema20 = sum(h1_closes[-20:]) / 20.0
                h1_bullish = curr_price > h1_ema20
                if (score > 0 and not h1_bullish) or (score < 0 and h1_bullish):
                    confidence -= 8  # Penalize counter-trend setups on Gold
                else:
                    confidence += 5  # Bonus for H1 + M15 confluence
                    smc_reasons.append("Согласие старшего таймфрейма H1")

            # Check spread
            tick = mt5_adapter.get_tick(symbol)
            if tick and tick.get("spread", 0) > 0.85:
                logger.info(f"Gold spread ({tick.get('spread')}) elevated. Filter holding back.")
                return None

        if not smc_reasons:
            smc_reasons.append("Чистый трендовый импульс по консенсусу EMA/MACD/RSI")

        side = "BUY" if score > 0 else "SELL"

        # Trade Plan Levels
        entry = round(curr_price, digits)
        min_risk = 1.0 if curr_price > 100 else 0.0010
        risk_dist = max(round(atr * 1.5, digits), min_risk)

        if side == "BUY":
            stop = round(entry - risk_dist, digits)
            tp1 = round(entry + risk_dist * 1.0, digits)
            tp2 = round(entry + risk_dist * 2.0, digits)
            tp3 = round(entry + risk_dist * 3.5, digits)
        else:
            stop = round(entry + risk_dist, digits)
            tp1 = round(entry - risk_dist * 1.0, digits)
            tp2 = round(entry - risk_dist * 2.0, digits)
            tp3 = round(entry - risk_dist * 3.5, digits)

        # Check upcoming high impact news
        has_news_risk, news_warning = news_service.is_high_impact_news_near(symbol, buffer_minutes=15)

        return {
            "symbol": symbol,
            "broker_symbol": meta.get("broker_symbol", symbol),
            "tf": tf,
            "side": side,
            "score": score,
            "confidence": min(98, confidence),
            "counts": analysis["counts"],
            "total_indicators": analysis["total"],
            "entry": entry,
            "stop": stop,
            "tp1": tp1,
            "tp2": tp2,
            "tp3": tp3,
            "risk_pts": round(risk_dist, digits),
            "smc_reason": " + ".join(smc_reasons),
            "has_smc_confluence": has_smc_confluence,
            "has_news_risk": has_news_risk,
            "news_warning": news_warning,
            "is_stale": meta.get("is_stale", False),
            "server": meta.get("source", "MetaTrader 5"),
            "timestamp": datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        }

    def format_signal_message(self, s: dict) -> tuple[str, dict]:
        sym_name = {
            "XAUUSD": "🥇 ЗОЛОТО (XAU/USD)",
            "BTCUSD": "⚡ BITCOIN (BTC/USD)",
            "EURUSD": "💶 ЕВРО (EUR/USD)",
            "GBPUSD": "💷 ФУНТ (GBP/USD)"
        }.get(s["symbol"], s["symbol"])

        side_emoji = "🟢" if s["side"] == "BUY" else "🔴"
        side_text = "ПОКУПКА (BUY / LONG)" if s["side"] == "BUY" else "ПРОДАЖА (SELL / SHORT)"
        
        bull_pct = int(s["counts"]["bull"] / max(s["total_indicators"], 1) * 100)
        bear_pct = int(s["counts"]["bear"] / max(s["total_indicators"], 1) * 100)
        agree_pct = bull_pct if s["side"] == "BUY" else bear_pct

        copy_text = (
            f"📈 СИГНАЛ MT5: {s['broker_symbol']}\n"
            f"Направление: {s['side']}\n"
            f"Вход: {s['entry']}\n"
            f"Стоп-Лосс: {s['stop']}\n"
            f"Тейк 1: {s['tp1']} (50%)\n"
            f"Тейк 2: {s['tp2']} (30%)\n"
            f"Тейк 3: {s['tp3']} (20%)"
        )

        news_banner = f"\n{s['news_warning']}\n" if s.get("has_news_risk") and s.get("news_warning") else ""

        msg = (
            f"<b>{side_emoji} НОВЫЙ ТОРГОВЫЙ СИГНАЛ (MT5)</b>\n"
            f"{news_banner}\n"
            f"🎯 <b>Инструмент:</b> {sym_name}\n"
            f"📊 <b>Тикер в MT5:</b> <code>{s['broker_symbol']}</code>\n"
            f"⚡ <b>Направление:</b> <b>{side_text}</b>\n"
            f"⏱ <b>Таймфрейм:</b> {s['tf']}\n"
            f"🔥 <b>Уверенность консенсуса:</b> <b>{s['confidence']}%</b> ({agree_pct}% индикаторов «ЗА»)\n\n"
            f"━━━━━━━━━━━━━━━━━━\n"
            f"📍 <b>Точка Входа:</b> <code>{s['entry']}</code>\n"
            f"🛑 <b>Стоп-Лосс (SL):</b> <code>{s['stop']}</code> (риск {s['risk_pts']})\n"
            f"🎯 <b>Тейк-Профит 1:</b> <code>{s['tp1']}</code> (R:R 1:1, фиксация 50% и Б/У)\n"
            f"🎯 <b>Тейк-Профит 2:</b> <code>{s['tp2']}</code> (R:R 1:2, фиксация 30%)\n"
            f"🎯 <b>Тейк-Профит 3:</b> <code>{s['tp3']}</code> (R:R 1:3.5, фиксация 20%)\n"
            f"━━━━━━━━━━━━━━━━━━\n\n"
            f"💡 <b>Обоснование сетапа:</b>\n"
            f"• {s['smc_reason']}\n"
            f"• Согласие <b>{s['counts']['bull' if s['side'] == 'BUY' else 'bear']}</b> индикаторов из {s['total_indicators']}\n"
            f"• Бот непрерывно следит за сделкой и уведомит о каждом тейк-профите!\n"
            f"• <i>Новые сигналы по {s['broker_symbol']} заблокированы до завершения текущей сделки.</i>\n\n"
            f"📋 <i>Параметры для ввода в MT5:</i>\n"
            f"<code>{copy_text}</code>"
        )

        inline_keyboard = []
        row = []
        if self.webapp_url and self.webapp_url.startswith("https://"):
            row.append({"text": "🚀 Открыть в Mini App", "web_app": {"url": self.webapp_url}})
        row.append({"text": "📋 Скопировать", "callback_data": f"copy_{s['symbol']}"})
        inline_keyboard.append(row)

        reply_markup = {"inline_keyboard": inline_keyboard} if inline_keyboard else None
        return msg, reply_markup

    async def scan_market_cycle(self):
        """
        Single run of market scanning across the 4 assets.
        Strict rule: If a symbol already has an active trade in progress, SKIP IT!
        """
        now = time.time()
        for symbol in SCAN_ASSETS:
            # 1. STRICT RULE: Check if this symbol already has an active trade
            if trade_tracker.has_active_trade(symbol):
                continue

            # 2. Check cooldown
            last_sent = self.last_signal_time.get(symbol, 0)
            if now - last_sent < SIGNAL_COOLDOWN_MINUTES * 60:
                continue

            for tf in SCAN_TIMEFRAMES:
                setup = self.analyze_asset_setup(symbol, tf)
                if not setup or setup["is_stale"]:
                    continue

                # STRICT CONFIDENCE FILTER
                is_confident = (
                    abs(setup["score"]) >= MIN_SCORE_THRESHOLD and
                    setup["confidence"] >= MIN_CONFIDENCE_THRESHOLD and
                    setup["has_smc_confluence"]
                )

                if is_confident:
                    logger.info(f"HIGH-CONFIDENCE SETUP FOUND: {symbol} {setup['side']} ({setup['confidence']}%, score={setup['score']:+.2f})")
                    # Register trade into active tracker
                    trade_tracker.register_trade(setup)
                    self.last_signal_time[symbol] = now

                    # Broadcast to subscribers
                    text, markup = self.format_signal_message(setup)
                    await self.broadcast_message(text, markup)
                    break

    async def monitor_active_trades_cycle(self):
        """
        Real-time tracking of open trades against live ticks.
        Notifies when TP1, TP2, TP3 or SL is hit.
        """
        ticks = {
            "XAUUSD": mt5_adapter.get_tick("XAUUSD") or {},
            "BTCUSD": mt5_adapter.get_tick("BTCUSD") or {},
            "EURUSD": mt5_adapter.get_tick("EURUSD") or {},
            "GBPUSD": mt5_adapter.get_tick("GBPUSD") or {}
        }

        events = trade_tracker.check_trade_updates(ticks)
        for trade, ev_type, curr_price in events:
            sym_name = {
                "XAUUSD": "🥇 ЗОЛОТО (GOLD)",
                "BTCUSD": "⚡ BITCOIN (BTC/USD)",
                "EURUSD": "💶 ЕВРО (EUR/USD)",
                "GBPUSD": "💷 ФУНТ (GBP/USD)"
            }.get(trade["symbol"], trade["symbol"])

            if ev_type == "tp1_hit":
                alert = (
                    f"🎯 <b>ТЕЙК-ПРОФИТ 1 ДОСТИГНУТ (+1.0R)!</b>\n\n"
                    f"Инструмент: <b>{sym_name}</b> ({trade['side']})\n"
                    f"Цена фиксации: <code>{curr_price}</code>\n"
                    f"💰 <b>Действие:</b> Зафиксировано <b>50% прибыли</b>!\n"
                    f"🛡 <b>Стоп-Лосс перенесен в БЕЗУБЫТОК:</b> <code>{trade['entry']}</code>\n"
                    f"🎉 Риск по сделке полностью снят! Оставшиеся 50% сопровождаются до TP2 и TP3."
                )
                await self.broadcast_message(alert)

            elif ev_type == "tp2_hit":
                alert = (
                    f"🎯 <b>ТЕЙК-ПРОФИТ 2 ДОСТИГНУТ (+2.0R)!</b>\n\n"
                    f"Инструмент: <b>{sym_name}</b> ({trade['side']})\n"
                    f"Цена фиксации: <code>{curr_price}</code>\n"
                    f"💰 <b>Действие:</b> Зафиксировано еще <b>30% прибыли</b>!\n"
                    f"🚀 Оставшиеся 20% позиции удерживаются до финальной цели TP3 (<code>{trade['tp3']}</code>)."
                )
                await self.broadcast_message(alert)

            elif ev_type == "tp3_hit":
                alert = (
                    f"🚀 <b>ФИНАЛЬНЫЙ ТЕЙК-ПРОФИТ 3 ВЗЯТ (+3.5R)!</b>\n\n"
                    f"Инструмент: <b>{sym_name}</b> ({trade['side']})\n"
                    f"Цена фиксации: <code>{curr_price}</code>\n"
                    f"🏆 <b>100% целей выполнено!</b> Сделка триумфально завершена.\n"
                    f"Слот для {sym_name} освобожден. Начинаем поиск следующего качественного входа!"
                )
                await self.broadcast_message(alert)

            elif ev_type == "sl_hit":
                reason = trade.get("close_reason", "Стоп-лосс")
                r_res = trade.get("realized_r", -1.0)
                alert = (
                    f"🛑 <b>СДЕЛКА ЗАКРЫТА: {sym_name}</b>\n\n"
                    f"Результат: <b>{reason}</b> (<code>{r_res:+.1f}R</code>)\n"
                    f"Цена выхода: <code>{curr_price}</code>\n"
                    f"Позиция полностью ликвидирована. Слот освобожден для новых сетапов."
                )
                await self.broadcast_message(alert)

    async def handle_command(self, chat_id: int, text: str, user_info: dict):
        cmd = text.strip()

        if cmd.startswith("/start"):
            is_new = self.add_subscriber(chat_id, user_info)
            welcome_text = (
                f"👋 <b>Добро пожаловать в Терминал MT TRADE!</b>\n\n"
                f"Я подключен к терминалу <b>MetaTrader 5</b> и в режиме <b>24/7</b> анализирую 4 актива:\n"
                f"🥇 <b>Золото (XAU/USD / GOLD)</b>\n"
                f"⚡ <b>Bitcoin (BTC/USD)</b>\n"
                f"💶 <b>Евро (EUR/USD)</b>\n"
                f"💷 <b>Фунт (GBP/USD)</b>\n\n"
                f"💎 <b>Умное ведение сделок:</b>\n"
                f"• Выдает вход, стоп-лосс и 3 тейк-профита.\n"
                f"• <b>Не ищет новых сделок по активу, пока не отработает текущая!</b>\n"
                f"• Следит за ценой в реальном времени и присылает уведомления при взятии TP1, TP2, TP3 и SL.\n"
                f"• Учитывает <b>экономический календарь и новости</b> перед отправкой сигнала.\n\n"
                f"Выберите нужный раздел в меню ниже:"
            )
            await self.send_message(chat_id, welcome_text, self.get_reply_keyboard())

        elif cmd in ["🎯 Получить сигнал прямо сейчас", "/signal"]:
            await self.send_message(chat_id, "🔍 <i>Сканирую котировки MT5 и проверяю активные позиции…</i>")
            
            # Check if any symbol is free and has a top setup
            best_setup = None
            best_score = -1.0

            for sym in SCAN_ASSETS:
                # If trade is already active, don't issue a conflicting trade
                if trade_tracker.has_active_trade(sym):
                    continue

                for tf in ["15m", "1h"]:
                    setup = self.analyze_asset_setup(sym, tf)
                    if setup and not setup["is_stale"]:
                        quality = setup["confidence"] + (10 if setup["has_smc_confluence"] else 0)
                        if quality > best_score:
                            best_score = quality
                            best_setup = setup

            if best_setup:
                # Register into tracker
                trade_tracker.register_trade(best_setup)
                msg, markup = self.format_signal_message(best_setup)
                await self.send_message(chat_id, msg, markup)
            else:
                active = trade_tracker.get_all_active_trades()
                if active:
                    active_names = ", ".join(t['broker_symbol'] for t in active)
                    await self.send_message(
                        chat_id,
                        f"⏳ <b>Сейчас в рынке активные позиции:</b> {active_names}.\n"
                        f"По правилам риск-менеджмента бот не открывает новые сделки по занятым активам до закрытия текущих. Нажмите «📊 Активные сделки», чтобы посмотреть прогресс!",
                        self.get_reply_keyboard()
                    )
                else:
                    await self.send_message(
                        chat_id,
                        "⚠️ Рынок в фазе консолидации или ожидаются важные новости. Нет сетапов с подтвержденным консенсусом >75%. Бот автоматически пришлет сигнал, как только сформируется качественный вход!",
                        self.get_reply_keyboard()
                    )

        elif cmd in ["📊 Активные сделки", "/trades"]:
            active = trade_tracker.get_all_active_trades()
            if not active:
                await self.send_message(
                    chat_id,
                    "💤 <b>В данный момент нет открытых сделок.</b>\n\nСканер непрерывно анализирует рынок и выдаст сигнал при появлении подтвержденной точки входа.",
                    self.get_reply_keyboard()
                )
                return

            lines = ["<b>📊 ТЕКУЩИЕ АКТИВНЫЕ ПОЗИЦИИ (В РАБОТЕ):</b>\n"]
            for t in active:
                side_em = "🟢 BUY" if t["side"] == "BUY" else "🔴 SELL"
                status_desc = {
                    "open": "В процессе (к TP1)",
                    "tp1_hit": "TP1 взят (Стоп в Б/У)",
                    "tp2_hit": "TP2 взят (Цель TP3)"
                }.get(t["status"], t["status"])

                curr_tick = mt5_adapter.get_tick(t["symbol"]) or {}
                price_now = curr_tick.get("bid" if t["side"] == "SELL" else "ask", t["last_price"])
                pnl_r = t.get("r_floating", 0.0)
                pnl_text = f"+{pnl_r:.2f}R" if pnl_r >= 0 else f"{pnl_r:.2f}R"

                lines.append(
                    f"• <b>{t['broker_symbol']}</b>: {side_em}\n"
                    f"  Статус: <b>{status_desc}</b>\n"
                    f"  Вход: <code>{t['entry']}</code> | Сейчас: <code>{price_now}</code>\n"
                    f"  Текущий результат: <b>{pnl_text}</b>\n"
                    f"  Стоп: <code>{t['stop']}</code> (Б/У: {'Да' if t.get('breakeven_active') else 'Нет'})\n"
                    f"  Цели: TP1 <code>{t['tp1']}</code> · TP2 <code>{t['tp2']}</code> · TP3 <code>{t['tp3']}</code>\n"
                )

            lines.append("<i>Бот автоматически уведомит вас при взятии каждого тейк-профита или стоп-лосса!</i>")
            await self.send_message(chat_id, "\n".join(lines), self.get_reply_keyboard())

        elif cmd in ["📰 Новости и прогноз рынка", "/news"]:
            digest = news_service.get_market_news_digest()
            f = digest["forecasts"]

            news_msg = (
                f"<b>📰 МАКРОЭКОНОМИКА И ПРОГНОЗ РЫНКА (MT5)</b>\n\n"
                f"🥇 <b>ЗОЛОТО (XAU/USD):</b> <b>{f['XAUUSD']['bias']}</b>\n"
                f"{f['XAUUSD']['text']}\n\n"
                f"⚡ <b>BITCOIN (BTC/USD):</b> <b>{f['BTCUSD']['bias']}</b>\n"
                f"{f['BTCUSD']['text']}\n\n"
                f"💶 <b>ЕВРО (EUR/USD):</b> <b>{f['EURUSD']['bias']}</b>\n"
                f"{f['EURUSD']['text']}\n\n"
                f"💷 <b>ФУНТ (GBP/USD):</b> <b>{f['GBPUSD']['bias']}</b>\n"
                f"{f['GBPUSD']['text']}\n\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"📅 <b>Ближайшие ключевые события календаря:</b>\n"
            )

            for ev in digest.get("calendar", [])[:4]:
                imp_em = "🔴" if ev.get("impact") == "High" else "🟡"
                news_msg += f"{imp_em} <b>{ev.get('country')}</b>: {ev.get('title')} (Прогноз: {ev.get('forecast') or '—'})\n"

            news_msg += f"\n<i>Обновлено: {digest['updated_at']}</i>"
            await self.send_message(chat_id, news_msg, self.get_reply_keyboard())

        elif cmd in ["🏆 Статистика винрейта", "/stats"]:
            stats = trade_tracker.get_stats()
            hist = trade_tracker.history[:5]

            hist_text = ""
            if hist:
                hist_text = "\n<b>Последние закрытые сделки:</b>\n"
                for h in hist:
                    r = h.get("realized_r", 0.0)
                    r_em = "🟢" if r > 0 else "🔴"
                    hist_text += f"{r_em} {h.get('broker_symbol')} {h.get('side')}: {h.get('close_reason')} ({r:+.1f}R)\n"

            stats_msg = (
                f"<b>🏆 СТАТИСТИКА И РЕЗУЛЬТАТЫ СИГНАЛОВ</b>\n\n"
                f"📊 <b>Всего отработано сделок:</b> {stats['total']}\n"
                f"✅ <b>Успешных (TP):</b> {stats['wins']}\n"
                f"❌ <b>Закрытых по SL:</b> {stats['losses']}\n"
                f"🎯 <b>Винрейт (Win Rate):</b> <b>{stats['win_rate']}%</b>\n"
                f"📈 <b>Суммарная прибыль в R:</b> <b>{stats['total_r']:+.2f}R</b>\n"
                f"🔄 <b>Сделок в работе сейчас:</b> {stats['active_count']}\n"
                f"{hist_text}"
            )
            await self.send_message(chat_id, stats_msg, self.get_reply_keyboard())

        elif cmd in ["⚙️ Статус MT5", "/status"]:
            status = mt5_adapter.get_status()
            gold_tick = mt5_adapter.get_tick("XAUUSD") or {}
            btc_tick = mt5_adapter.get_tick("BTCUSD") or {}
            eur_tick = mt5_adapter.get_tick("EURUSD") or {}
            gbp_tick = mt5_adapter.get_tick("GBPUSD") or {}

            conn_emoji = "🟢" if status.get("is_connected") else "🔴"
            conn_text = "ПОДКЛЮЧЕН (ONLINE)" if status.get("is_connected") else "ОФФЛАЙН (Проверьте запуск MT5)"

            def fmt_quote(tick, digits=2):
                if not tick or "bid" not in tick:
                    return "нет котировок"
                return f"Bid: {tick['bid']:.{digits}f} / Ask: {tick['ask']:.{digits}f} (спред {tick.get('spread', 0)})"

            status_msg = (
                f"<b>⚙️ СТАТУС ТОРГОВОГО ДВИЖКА METATRADER 5</b>\n\n"
                f"{conn_emoji} <b>Связь с терминалом:</b> {conn_text}\n"
                f"🖥 <b>Сервер брокера:</b> <code>{status.get('server', 'XMGlobal')}</code>\n"
                f"👥 <b>Подписчиков бота:</b> {len(self.subscribers)}\n\n"
                f"<b>⚡ Текущие котировки MT5:</b>\n"
                f"🥇 <b>GOLD:</b> {fmt_quote(gold_tick, 2)}\n"
                f"⚡ <b>BTCUSD:</b> {fmt_quote(btc_tick, 2)}\n"
                f"💶 <b>EURUSD:</b> {fmt_quote(eur_tick, 5)}\n"
                f"💷 <b>GBPUSD:</b> {fmt_quote(gbp_tick, 5)}\n\n"
                f"<i>Сканер непрерывно анализирует графики каждые {SCAN_INTERVAL_SECONDS} секунд.</i>"
            )
            await self.send_message(chat_id, status_msg, self.get_reply_keyboard())

        elif cmd in ["🔍 Сканер рынка (4 актива)", "/scanner"]:
            scan_lines = []
            for sym in SCAN_ASSETS:
                s = self.analyze_asset_setup(sym, "15m")
                active = trade_tracker.has_active_trade(sym)
                status_tag = " [В РАБОТЕ]" if active else ""
                if s:
                    dir_em = "🟢 BUY" if s["side"] == "BUY" else "🔴 SELL"
                    scan_lines.append(
                        f"• <b>{s['broker_symbol']}</b>: {dir_em} · Уверенность: <b>{s['confidence']}%</b> (Вход: <code>{s['entry']}</code>){status_tag}"
                    )
                else:
                    scan_lines.append(f"• <b>{sym}</b>: Загрузка данных MT5…{status_tag}")

            scanner_msg = (
                f"<b>🔍 РЕЗУЛЬТАТЫ СКАНИРОВАНИЯ РЫНКА (M15)</b>\n\n"
                + "\n".join(scan_lines) +
                f"\n\n<i>При пробое структуры или тесте FVG бот автоматически отправит подробный торговый сетап!</i>"
            )
            await self.send_message(chat_id, scanner_msg, self.get_reply_keyboard())

        elif cmd.startswith("/set_url"):
            parts = cmd.split(maxsplit=1)
            if len(parts) > 1 and parts[1].startswith("http"):
                new_url = parts[1].strip()
                self.webapp_url = new_url
                save_dynamic_config({"webapp_url": new_url})
                await self.setup_bot_menu()
                await self.send_message(
                    chat_id,
                    f"✅ <b>URL для Telegram Mini App обновлен!</b>\n\nНовый адрес: <code>{new_url}</code>\nКнопка меню обновлена.",
                    self.get_reply_keyboard()
                )
            else:
                await self.send_message(chat_id, "Использование: <code>/set_url https://ваш-домен-или-ngrok</code>")

    async def handle_callback_query(self, query: dict):
        qid = query.get("id")
        data = query.get("data", "")
        chat_id = query.get("message", {}).get("chat", {}).get("id")

        if data.startswith("copy_"):
            sym = data.replace("copy_", "")
            trade = trade_tracker.get_active_trade(sym) or self.analyze_asset_setup(sym, "15m")
            if trade:
                copy_text = (
                    f"📈 МТ5 СИГНАЛ: {trade['broker_symbol']}\n"
                    f"Вход: {trade['entry']}\n"
                    f"Стоп-Лосс: {trade['stop']}\n"
                    f"Тейк 1: {trade['tp1']}\n"
                    f"Тейк 2: {trade['tp2']}\n"
                    f"Тейк 3: {trade['tp3']}"
                )
                await self.api_call("answerCallbackQuery", {"callback_query_id": qid, "text": "Параметры скопированы!"})
                if chat_id:
                    await self.send_message(chat_id, f"📋 <b>Параметры для MT5 ({trade['broker_symbol']}):</b>\n<code>{copy_text}</code>")
            else:
                await self.api_call("answerCallbackQuery", {"callback_query_id": qid, "text": "Котировки обновляются..."})

    async def polling_worker(self):
        """Continuous Telegram update polling loop."""
        logger.info(f"Starting Telegram Bot polling loop for @{self.username}...")
        await self.setup_bot_menu()

        while self.is_running:
            try:
                updates = await self.api_call("getUpdates", {"offset": self.last_update_id + 1, "timeout": 20})
                if updates and updates.get("ok"):
                    for item in updates.get("result", []):
                        self.last_update_id = item["update_id"]
                        if "message" in item:
                            msg = item["message"]
                            chat_id = msg.get("chat", {}).get("id")
                            text = msg.get("text", "")
                            user_info = msg.get("from", {})
                            if chat_id and text:
                                await self.handle_command(chat_id, text, user_info)
                        elif "callback_query" in item:
                            await self.handle_callback_query(item["callback_query"])
            except Exception as e:
                logger.error(f"Error in polling worker: {e}")
                await asyncio.sleep(4)
            await asyncio.sleep(0.5)

    async def scanner_worker(self):
        """Continuous 24/7 market scanner & active trade monitor loop."""
        logger.info("Starting 24/7 Market Scanner & Trade Position Monitor...")
        await asyncio.sleep(4)

        scan_counter = 0
        while self.is_running:
            try:
                if mt5_adapter.is_connected:
                    # 1. Real-time active trade lifecycle monitor (runs every 2 seconds)
                    await self.monitor_active_trades_cycle()

                    # 2. Market scan cycle for new opportunities (runs every SCAN_INTERVAL_SECONDS)
                    scan_counter += 2
                    if scan_counter >= SCAN_INTERVAL_SECONDS:
                        scan_counter = 0
                        await self.scan_market_cycle()
            except Exception as e:
                logger.error(f"Error in market scanner/monitor worker: {e}")
            await asyncio.sleep(2)

    async def start(self):
        self.is_running = True
        logger.info("Initializing Telegram Signal Bot Service...")
        await asyncio.gather(
            self.polling_worker(),
            self.scanner_worker()
        )

    def stop(self):
        self.is_running = False
        if self.client:
            asyncio.create_task(self.client.aclose())

telegram_bot = TelegramSignalBot()
