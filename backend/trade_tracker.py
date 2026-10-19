"""
Persistent Trade Tracker & Active Position Monitor for MT5 Live Signals.
Enforces:
1. Real-time monitoring of TP1, TP2, TP3 and Stop Loss against live MT5 ticks.
2. Breakeven relocation of Stop Loss on TP1.
3. Strict rule: NO new signals while an active trade is in progress for that asset.
4. Persistent memory across terminal/server restarts.
"""
import os
import json
import time
import logging
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional, Tuple

logger = logging.getLogger("trade_tracker")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACTIVE_TRADES_FILE = os.path.join(BASE_DIR, "backend", "active_trades.json")
HISTORY_FILE = os.path.join(BASE_DIR, "backend", "trades_history.json")

class TradeTracker:
    def __init__(self):
        self.active_trades: Dict[str, Dict[str, Any]] = self._load_active_trades()
        self.history: List[Dict[str, Any]] = self._load_history()

    def _load_active_trades(self) -> Dict[str, Dict[str, Any]]:
        if os.path.exists(ACTIVE_TRADES_FILE):
            try:
                with open(ACTIVE_TRADES_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error loading active trades: {e}")
        return {}

    def _save_active_trades(self):
        try:
            with open(ACTIVE_TRADES_FILE, "w", encoding="utf-8") as f:
                json.dump(self.active_trades, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Error saving active trades: {e}")

    def _load_history(self) -> List[Dict[str, Any]]:
        if os.path.exists(HISTORY_FILE):
            try:
                with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error loading trade history: {e}")
        return []

    def _save_history(self):
        try:
            with open(HISTORY_FILE, "w", encoding="utf-8") as f:
                json.dump(self.history, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Error saving trade history: {e}")

    def has_active_trade(self, symbol: str) -> bool:
        """
        Returns True if an open or partially completed trade exists for this symbol.
        No new signal can be generated while this returns True.
        """
        trade = self.active_trades.get(symbol)
        if not trade:
            return False
        return trade.get("status") in ["open", "tp1_hit", "tp2_hit"]

    def get_active_trade(self, symbol: str) -> Optional[Dict[str, Any]]:
        trade = self.active_trades.get(symbol)
        if trade and trade.get("status") in ["open", "tp1_hit", "tp2_hit"]:
            return trade
        return None

    def get_all_active_trades(self) -> List[Dict[str, Any]]:
        return [t for t in self.active_trades.values() if t.get("status") in ["open", "tp1_hit", "tp2_hit"]]

    def register_trade(self, s: Dict[str, Any]) -> Dict[str, Any]:
        """
        Registers a new high-confidence trade setup into persistent active tracking.
        """
        symbol = s["symbol"]
        trade_id = f"tr_{symbol}_{int(time.time())}"
        
        trade = {
            "id": trade_id,
            "symbol": symbol,
            "broker_symbol": s.get("broker_symbol", symbol),
            "tf": s.get("tf", "15m"),
            "side": s["side"],
            "entry": s["entry"],
            "stop": s["stop"],
            "original_stop": s["stop"],
            "tp1": s["tp1"],
            "tp2": s["tp2"],
            "tp3": s["tp3"],
            "risk_pts": s.get("risk_pts", 0.0),
            "confidence": s.get("confidence", 80),
            "smc_reason": s.get("smc_reason", ""),
            "status": "open",  # "open" -> "tp1_hit" -> "tp2_hit" -> "closed_win" / "closed_loss"
            "tp1_notified": False,
            "tp2_notified": False,
            "tp3_notified": False,
            "sl_notified": False,
            "breakeven_active": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_ts": time.time(),
            "last_price": s["entry"],
            "r_floating": 0.0,
            "closed_at": None,
            "close_reason": None,
            "realized_r": 0.0
        }

        self.active_trades[symbol] = trade
        self._save_active_trades()
        logger.info(f"Registered ACTIVE trade for {symbol} {trade['side']} @ {trade['entry']} (SL: {trade['stop']}, TP1: {trade['tp1']})")
        return trade

    def check_trade_updates(self, ticks: Dict[str, Dict[str, Any]]) -> List[Tuple[Dict[str, Any], str, float]]:
        """
        Inspects active trades against live market ticks.
        Returns list of (trade, event_type, current_price):
        event_type in ["tp1_hit", "tp2_hit", "tp3_hit", "sl_hit"]
        """
        events = []
        now = time.time()

        for symbol, trade in list(self.active_trades.items()):
            if trade.get("status") not in ["open", "tp1_hit", "tp2_hit"]:
                continue

            tick = ticks.get(symbol)
            if not tick or "bid" not in tick:
                continue

            # Bid for Sell, Ask for Buy
            side = trade["side"]
            curr_price = tick["ask"] if side == "BUY" else tick["bid"]
            entry = trade["entry"]
            stop = trade["stop"]
            risk = max(abs(entry - trade["original_stop"]), 0.0001)

            trade["last_price"] = curr_price
            
            # Calculate floating R
            if side == "BUY":
                trade["r_floating"] = round((curr_price - entry) / risk, 2)
            else:
                trade["r_floating"] = round((entry - curr_price) / risk, 2)

            # 1. Check STOP LOSS hit
            sl_hit = False
            if side == "BUY" and curr_price <= stop:
                sl_hit = True
            elif side == "SELL" and curr_price >= stop:
                sl_hit = True

            if sl_hit and not trade.get("sl_notified"):
                trade["sl_notified"] = True
                trade["status"] = "closed_loss"
                trade["closed_at"] = datetime.now(timezone.utc).isoformat()
                if trade.get("breakeven_active"):
                    trade["close_reason"] = "Безубыток (Breakeven)"
                    trade["realized_r"] = 0.5  # Fixed 50% at TP1
                else:
                    trade["close_reason"] = "Стоп-лосс (Stop Loss)"
                    trade["realized_r"] = -1.0

                events.append((dict(trade), "sl_hit", curr_price))
                self._archive_trade(symbol, trade)
                continue

            # 2. Check TAKE PROFIT 3 (Full Win)
            tp3_hit = False
            if side == "BUY" and curr_price >= trade["tp3"]:
                tp3_hit = True
            elif side == "SELL" and curr_price <= trade["tp3"]:
                tp3_hit = True

            if tp3_hit and not trade.get("tp3_notified"):
                trade["tp3_notified"] = True
                trade["status"] = "closed_win"
                trade["closed_at"] = datetime.now(timezone.utc).isoformat()
                trade["close_reason"] = "Полный Тейк-Профит TP3 (+3.5R)"
                trade["realized_r"] = 3.5

                events.append((dict(trade), "tp3_hit", curr_price))
                self._archive_trade(symbol, trade)
                continue

            # 3. Check TAKE PROFIT 2
            tp2_hit = False
            if side == "BUY" and curr_price >= trade["tp2"]:
                tp2_hit = True
            elif side == "SELL" and curr_price <= trade["tp2"]:
                tp2_hit = True

            if tp2_hit and not trade.get("tp2_notified"):
                trade["tp2_notified"] = True
                trade["status"] = "tp2_hit"
                events.append((dict(trade), "tp2_hit", curr_price))
                self._save_active_trades()

            # 4. Check TAKE PROFIT 1
            tp1_hit = False
            if side == "BUY" and curr_price >= trade["tp1"]:
                tp1_hit = True
            elif side == "SELL" and curr_price <= trade["tp1"]:
                tp1_hit = True

            if tp1_hit and not trade.get("tp1_notified"):
                trade["tp1_notified"] = True
                trade["status"] = "tp1_hit"
                # Move Stop Loss to Entry (Breakeven)
                trade["stop"] = entry
                trade["breakeven_active"] = True
                logger.info(f"Trade {symbol} hit TP1! Moved SL to Breakeven {entry}.")
                events.append((dict(trade), "tp1_hit", curr_price))
                self._save_active_trades()

        return events

    def _archive_trade(self, symbol: str, trade: Dict[str, Any]):
        """Moves a closed trade to history and removes from active tracking."""
        self.history.insert(0, dict(trade))
        if len(self.history) > 200:
            self.history.pop()
        self._save_history()
        
        if symbol in self.active_trades:
            del self.active_trades[symbol]
        self._save_active_trades()
        logger.info(f"Archived trade for {symbol}. Result: {trade.get('close_reason')} ({trade.get('realized_r')}R). Active slot is now FREE for new signals.")

    def get_stats(self) -> Dict[str, Any]:
        """Calculates win/loss metrics and R multiples."""
        total = len(self.history)
        if total == 0:
            return {
                "total": 0,
                "wins": 0,
                "losses": 0,
                "win_rate": 0.0,
                "total_r": 0.0,
                "active_count": len(self.get_all_active_trades())
            }

        wins = sum(1 for t in self.history if t.get("status") == "closed_win" or (t.get("realized_r", 0) > 0))
        losses = sum(1 for t in self.history if t.get("realized_r", 0) < 0)
        total_r = sum(t.get("realized_r", 0.0) for t in self.history)
        win_rate = round((wins / total) * 100, 1) if total > 0 else 0.0

        return {
            "total": total,
            "wins": wins,
            "losses": losses,
            "win_rate": win_rate,
            "total_r": round(total_r, 2),
            "active_count": len(self.get_all_active_trades())
        }

trade_tracker = TradeTracker()
