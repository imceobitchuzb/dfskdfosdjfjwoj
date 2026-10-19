"""
MetaTrader 5 Live Market Data Adapter.
Connects to the desktop MT5 terminal, discovers symbols, streams ticks and historical OHLC candles.
"""
import os
import time
import threading
import logging
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional, Tuple

logger = logging.getLogger("mt5_adapter")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False
    logger.warning("MetaTrader5 package is not installed.")

# Map timeframe strings to MT5 timeframe constants
TIMEFRAME_MAP = {}
if MT5_AVAILABLE:
    TIMEFRAME_MAP = {
        "1m": mt5.TIMEFRAME_M1,
        "5m": mt5.TIMEFRAME_M5,
        "15m": mt5.TIMEFRAME_M15,
        "30m": mt5.TIMEFRAME_M30,
        "1h": mt5.TIMEFRAME_H1,
        "4h": mt5.TIMEFRAME_H4,
        "8h": getattr(mt5, "TIMEFRAME_H8", mt5.TIMEFRAME_H4),
        "1d": mt5.TIMEFRAME_D1,
    }

DEFAULT_TERMINAL_PATH = r"C:\Program Files\MetaTrader 5\terminal64.exe"

class MT5Adapter:
    def __init__(self):
        self._lock = threading.RLock()
        self.is_connected = False
        self.connection_status = "INITIALIZING"
        self.error_message = ""
        self.terminal_path = DEFAULT_TERMINAL_PATH if os.path.exists(DEFAULT_TERMINAL_PATH) else ""
        self.server_name = ""
        self.account_id = ""
        self.last_update_ts = 0
        self.last_reconnect_attempt = 0
        self.reconnect_interval = 5.0
        
        # Discovered broker symbol mappings: generic -> broker specific
        # e.g., "XAUUSD" -> "GOLD" or "XAUUSD.s"
        self.symbol_map: Dict[str, str] = {
            "XAUUSD": "GOLD",
            "BTCUSD": "BTCUSD",
            "EURUSD": "EURUSD",
            "GBPUSD": "GBPUSD"
        }
        self.all_symbols: List[str] = []
        
        # In-memory rate cache: (symbol, tf) -> list of [time, open, high, low, close, volume]
        self._candle_cache: Dict[Tuple[str, str], List[List[float]]] = {}
        # Tick cache: symbol -> dict
        self._tick_cache: Dict[str, Dict[str, Any]] = {}
        
        # Default accounts to try if desktop terminal requires credentials
        self.known_accounts = [
            (318657109, "XMGlobal-MT5 7"),
            (0, "") # default running terminal without explicit login
        ]
        
        # Background worker
        self._stop_event = threading.Event()
        self._worker_thread = threading.Thread(target=self._background_loop, daemon=True, name="MT5AdapterWorker")
        self._worker_thread.start()

    def connect(self) -> bool:
        if not MT5_AVAILABLE:
            self.connection_status = "PACKAGE_MISSING"
            self.error_message = "Python package 'MetaTrader5' is not installed."
            return False

        with self._lock:
            # 1. Try connecting without explicit login first (connect to already running terminal)
            initialized = False
            for login, server in self.known_accounts:
                try:
                    kwargs = {"timeout": 6000}
                    if self.terminal_path:
                        kwargs["path"] = self.terminal_path
                    if login and server:
                        kwargs["login"] = login
                        kwargs["server"] = server
                        
                    res = mt5.initialize(**kwargs)
                    if res:
                        initialized = True
                        break
                except Exception as e:
                    logger.debug(f"Init attempt failed for login {login}: {e}")
                    
            if not initialized:
                err = mt5.last_error()
                self.is_connected = False
                self.connection_status = "DISCONNECTED"
                self.error_message = f"MT5 connection failed: {err[1]} (code {err[0]})"
                logger.warning(self.error_message)
                return False

            # Retrieve terminal and account info
            t_info = mt5.terminal_info()
            a_info = mt5.account_info()
            
            self.is_connected = True
            self.connection_status = "CONNECTED"
            self.error_message = ""
            self.server_name = a_info.server if a_info else (t_info.name if t_info else "Local Terminal")
            self.account_id = str(a_info.login) if a_info else ""
            self.last_update_ts = int(time.time())
            
            logger.info(f"Connected to MT5 on {self.server_name} (Account: {self.account_id})")
            
            # Discover and map symbols
            self._discover_symbols()
            
            # Preload initial ticks and candles for default symbols
            for gen_sym in list(self.symbol_map.keys()):
                self._update_symbol_tick(gen_sym)
                for tf in ["5m", "15m", "1h", "4h", "1d"]:
                    self._fetch_candles_from_mt5(gen_sym, tf, 100)
                    
            return True

    def _discover_symbols(self):
        """Discovers exact broker symbol names for Gold, Crypto, and major currencies."""
        if not self.is_connected:
            return
            
        symbols = mt5.symbols_get()
        if not symbols:
            return
            
        self.all_symbols = [s.name for s in symbols]
        sym_names_upper = {s.name.upper(): s.name for s in symbols}
        
        # 1. Gold detection
        gold_candidates = ["GOLD", "XAUUSD", "XAUUSD.S", "XAUUSDM", "XAUUSD_I", "GOLD.S", "GOLD.M"]
        gold_match = None
        for candidate in gold_candidates:
            if candidate in sym_names_upper:
                gold_match = sym_names_upper[candidate]
                break
        if not gold_match:
            # fallback: find any symbol containing XAU or GOLD
            for s_name in self.all_symbols:
                s_up = s_name.upper()
                if (s_up.startswith("XAU") or s_up.startswith("GOLD")) and "EUR" not in s_up and "JPY" not in s_up:
                    gold_match = s_name
                    break
        if gold_match:
            self.symbol_map["XAUUSD"] = gold_match
            logger.info(f"Discovered Gold symbol: {gold_match}")

        # 2. BTC detection
        btc_candidates = ["BTCUSD", "BTCUSD.S", "BTCUSDM", "BITCOIN", "BTC/USD"]
        for candidate in btc_candidates:
            if candidate in sym_names_upper:
                self.symbol_map["BTCUSD"] = sym_names_upper[candidate]
                break

        # 3. EUR detection
        eur_candidates = ["EURUSD", "EURUSD.S", "EURUSDM", "EURUSD_I", "EUR/USD"]
        for candidate in eur_candidates:
            if candidate in sym_names_upper:
                self.symbol_map["EURUSD"] = sym_names_upper[candidate]
                break

        # 4. GBP detection
        gbp_candidates = ["GBPUSD", "GBPUSD.S", "GBPUSDM", "GBPUSD_I", "GBP/USD"]
        for candidate in gbp_candidates:
            if candidate in sym_names_upper:
                self.symbol_map["GBPUSD"] = sym_names_upper[candidate]
                break

        # Ensure selected symbols are added to Market Watch
        for broker_sym in self.symbol_map.values():
            try:
                mt5.symbol_select(broker_sym, True)
            except Exception:
                pass

    def get_broker_symbol(self, generic_symbol: str) -> str:
        clean = generic_symbol.upper().replace("/", "")
        return self.symbol_map.get(clean, self.symbol_map.get("XAUUSD", "GOLD"))

    def _update_symbol_tick(self, generic_symbol: str) -> Optional[Dict[str, Any]]:
        if not self.is_connected:
            return None
            
        broker_sym = self.get_broker_symbol(generic_symbol)
        try:
            tick = mt5.symbol_info_tick(broker_sym)
            if not tick or tick.bid == 0:
                return None
                
            now = int(time.time())
            age = max(0, now - tick.time)
            
            # Formatted spread
            spread_pts = round((tick.ask - tick.bid), 5 if tick.bid < 10 else 2)
            
            tick_data = {
                "symbol": generic_symbol,
                "broker_symbol": broker_sym,
                "bid": round(tick.bid, 5 if tick.bid < 10 else 2),
                "ask": round(tick.ask, 5 if tick.bid < 10 else 2),
                "last": round(tick.last if tick.last > 0 else tick.bid, 5 if tick.bid < 10 else 2),
                "spread": spread_pts,
                "time": tick.time,
                "time_msc": tick.time_msc,
                "datetime_utc": datetime.fromtimestamp(tick.time, timezone.utc).isoformat(),
                "age_seconds": age,
                "is_stale": age > 120,
                "source": f"MetaTrader 5 ({self.server_name})"
            }
            with self._lock:
                self._tick_cache[generic_symbol] = tick_data
                self.last_update_ts = now
            return tick_data
        except Exception as e:
            logger.error(f"Error updating tick for {broker_sym}: {e}")
            return None

    def _fetch_candles_from_mt5(self, generic_symbol: str, tf: str, limit: int = 120) -> List[List[float]]:
        if not self.is_connected or not MT5_AVAILABLE:
            return []
            
        broker_sym = self.get_broker_symbol(generic_symbol)
        mt5_tf = TIMEFRAME_MAP.get(tf, mt5.TIMEFRAME_M15)
        
        try:
            rates = mt5.copy_rates_from_pos(broker_sym, mt5_tf, 0, limit)
            if rates is None or len(rates) == 0:
                logger.warning(f"No rates returned for {broker_sym} {tf}")
                return []
                
            candles = []
            digits = 5 if rates[0][1] < 10 else 2
            for r in rates:
                # r is a named tuple: (time, open, high, low, close, tick_volume, spread, real_volume)
                t = int(r[0])
                o = round(float(r[1]), digits)
                h = round(float(r[2]), digits)
                l = round(float(r[3]), digits)
                c = round(float(r[4]), digits)
                v = int(r[5])
                candles.append([t, o, h, l, c, v])
                
            with self._lock:
                self._candle_cache[(generic_symbol, tf)] = candles
            return candles
        except Exception as e:
            logger.error(f"Error fetching candles for {broker_sym} {tf}: {e}")
            return []

    def get_candles(self, generic_symbol: str, tf: str = "15m", count: int = 80) -> Tuple[List[List[float]], Dict[str, Any]]:
        """
        Returns (candles, metadata).
        candles: list of [timestamp, open, high, low, close, volume]
        metadata: source, broker_symbol, is_live, is_stale, last_tick_time
        """
        generic_symbol = generic_symbol.upper().replace("/", "")
        with self._lock:
            # 1. If connected, try getting fresh candles from MT5
            if self.is_connected:
                fresh = self._fetch_candles_from_mt5(generic_symbol, tf, count)
                if fresh and len(fresh) > 0:
                    tick_info = self._tick_cache.get(generic_symbol, {})
                    is_stale = tick_info.get("is_stale", False)
                    meta = {
                        "source": f"MetaTrader 5 ({self.server_name})",
                        "broker_symbol": self.get_broker_symbol(generic_symbol),
                        "server": self.server_name,
                        "account": self.account_id,
                        "is_live": True,
                        "is_stale": is_stale,
                        "last_tick_time": tick_info.get("datetime_utc", ""),
                        "age_seconds": tick_info.get("age_seconds", 0)
                    }
                    return fresh[-count:], meta

            # 2. If disconnected or fetch failed, check cache
            cached = self._candle_cache.get((generic_symbol, tf), [])
            if cached and len(cached) > 0:
                meta = {
                    "source": f"MT5 ОФЛАЙН КЭШ ({self.server_name or 'Нет связи'})",
                    "broker_symbol": self.get_broker_symbol(generic_symbol),
                    "server": self.server_name,
                    "account": self.account_id,
                    "is_live": False,
                    "is_stale": True,
                    "last_tick_time": "",
                    "age_seconds": int(time.time() - self.last_update_ts) if self.last_update_ts else 999999
                }
                return cached[-count:], meta

            # 3. No connection and no cache
            meta = {
                "source": "MT5 ОТКЛЮЧЕН (Терминал не запущен)",
                "broker_symbol": self.get_broker_symbol(generic_symbol),
                "server": "",
                "account": "",
                "is_live": False,
                "is_stale": True,
                "last_tick_time": "",
                "age_seconds": 999999
            }
            return [], meta

    def get_tick(self, generic_symbol: str) -> Optional[Dict[str, Any]]:
        generic_symbol = generic_symbol.upper().replace("/", "")
        with self._lock:
            if self.is_connected:
                t = self._update_symbol_tick(generic_symbol)
                if t:
                    return t
            return self._tick_cache.get(generic_symbol)

    def get_current_price(self, generic_symbol: str) -> float:
        t = self.get_tick(generic_symbol)
        if t and t.get("bid"):
            return t["bid"]
        candles, _ = self.get_candles(generic_symbol, "15m", 5)
        if candles:
            return candles[-1][4]
        return 0.0

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            gold_sym = self.get_broker_symbol("XAUUSD")
            gold_tick = self._tick_cache.get("XAUUSD", {})
            return {
                "is_connected": self.is_connected,
                "status": self.connection_status,
                "error": self.error_message,
                "server": self.server_name,
                "account": self.account_id,
                "terminal_path": self.terminal_path,
                "symbol_map": self.symbol_map,
                "gold_symbol": gold_sym,
                "last_update_ts": self.last_update_ts,
                "gold_tick": gold_tick,
                "available_timeframes": list(TIMEFRAME_MAP.keys())
            }

    def _background_loop(self):
        """Continuously monitors MT5 connection, polls ticks every 1.5s, and reconnects on disconnection."""
        while not self._stop_event.is_set():
            now = time.time()
            if not self.is_connected:
                if now - self.last_reconnect_attempt >= self.reconnect_interval:
                    self.last_reconnect_attempt = now
                    try:
                        self.connect()
                    except Exception as e:
                        logger.error(f"Background reconnect error: {e}")
            else:
                # Connected: poll live ticks for all active symbols
                try:
                    for gen_sym in list(self.symbol_map.keys()):
                        self._update_symbol_tick(gen_sym)
                except Exception as e:
                    logger.error(f"Tick update error: {e}")
                    self.is_connected = False
                    self.connection_status = "CONNECTION_LOST"

            time.sleep(1.5)

    def stop(self):
        self._stop_event.set()
        if MT5_AVAILABLE:
            try:
                mt5.shutdown()
            except Exception:
                pass

# Singleton instance
mt5_adapter = MT5Adapter()
