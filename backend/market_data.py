"""
Market data feed provider backed by real MetaTrader 5 adapter.
Eliminates synthetic random mock data in favor of genuine terminal data.
"""
from typing import List, Dict, Any, Tuple
from backend.mt5_adapter import mt5_adapter

class MarketFeed:
    def __init__(self):
        self.adapter = mt5_adapter

    def get_candles(self, symbol: str, tf: str = "15m", count: int = 80) -> List[List[float]]:
        candles, _ = self.adapter.get_candles(symbol, tf, count)
        return candles

    def get_candles_with_meta(self, symbol: str, tf: str = "15m", count: int = 80) -> Tuple[List[List[float]], Dict[str, Any]]:
        return self.adapter.get_candles(symbol, tf, count)

    def get_current_price(self, symbol: str) -> float:
        return self.adapter.get_current_price(symbol)

    def get_tick(self, symbol: str) -> Dict[str, Any]:
        return self.adapter.get_tick(symbol)

    def get_status(self) -> Dict[str, Any]:
        return self.adapter.get_status()

market_feed = MarketFeed()
