"""
Smart Money Concepts (SMC) module:
- Fair Value Gaps (FVG)
- Order Blocks (OB)
- Liquidity Pools & Sweeps
- Market Structure (BOS & CHoCH)
- Trading Sessions (Asia, London, New York)
"""
from typing import List, Dict, Any

def analyze_smc(candles: List[List[float]], atr: float) -> Dict[str, Any]:
    """
    candles: [[timestamp, open, high, low, close, volume], ...]
    """
    n = len(candles)
    if n < 5:
        return {"fvg": [], "ob": [], "sessions": [], "events": [], "liquidity": {"pools": [], "swept": []}}

    # 1. Fair Value Gaps (FVG)
    fvg_list = []
    for i in range(2, n):
        # Bullish FVG: candle[i-2].high < candle[i].low
        if candles[i][3] > candles[i-2][2] + (0.1 * atr):
            gap_bottom = candles[i-2][2]
            gap_top = candles[i][3]
            fvg_list.append({
                "time": candles[i-1][0],
                "type": "bull",
                "top": round(gap_top, 2),
                "bottom": round(gap_bottom, 2),
                "open_top": round(gap_top, 2),
                "open_bottom": round(gap_bottom, 2),
                "size": round((gap_top - gap_bottom) / max(atr, 0.1), 2),
                "filled": 0.0,
                "grade": 1.5,
                "htf": False
            })
        # Bearish FVG: candle[i-2].low > candle[i].high
        elif candles[i-2][3] > candles[i][2] + (0.1 * atr):
            gap_top = candles[i-2][3]
            gap_bottom = candles[i][2]
            fvg_list.append({
                "time": candles[i-1][0],
                "type": "bear",
                "top": round(gap_top, 2),
                "bottom": round(gap_bottom, 2),
                "open_top": round(gap_top, 2),
                "open_bottom": round(gap_bottom, 2),
                "size": round((gap_top - gap_bottom) / max(atr, 0.1), 2),
                "filled": 0.0,
                "grade": 1.5,
                "htf": False
            })

    # 2. Order Blocks (OB)
    ob_list = []
    for i in range(3, n - 2):
        # Bullish OB: last down candle before a strong upward impulse
        if candles[i][4] < candles[i][1] and candles[i+1][4] > candles[i+1][1] and candles[i+2][4] > candles[i][2]:
            ob_list.append({
                "time": candles[i][0],
                "type": "bull",
                "top": round(candles[i][2], 2),
                "bottom": round(candles[i][3], 2),
                "touches": 0,
                "grade": 1.2
            })
        # Bearish OB: last up candle before a strong downward drop
        elif candles[i][4] > candles[i][1] and candles[i+1][4] < candles[i+1][1] and candles[i+2][4] < candles[i][3]:
            ob_list.append({
                "time": candles[i][0],
                "type": "bear",
                "top": round(candles[i][2], 2),
                "bottom": round(candles[i][3], 2),
                "touches": 0,
                "grade": 1.2
            })

    # 3. Liquidity Pools (Equal Highs/Lows, Swing Highs/Lows)
    curr_price = candles[-1][4]
    pools = []
    swept = []
    for i in range(5, n - 3):
        # Swing High
        if candles[i][2] > max(c[2] for c in candles[i-3:i]) and candles[i][2] > max(c[2] for c in candles[i+1:i+4]):
            p_price = round(candles[i][2], 2)
            dist_atr = round(abs(p_price - curr_price) / max(atr, 0.1), 2)
            # check if swept by recent candles
            if any(c[2] > p_price for c in candles[i+1:]):
                swept_candle = next(c for c in candles[i+1:] if c[2] > p_price)
                swept.append({
                    "price": p_price,
                    "kind": "Снятие ликвидности High",
                    "swept_time": swept_candle[0]
                })
            else:
                pools.append({
                    "price": p_price,
                    "kind": "Buy-side Liquidity",
                    "label": "Пул ликвидности на покупку",
                    "rating": 3 if dist_atr < 2.0 else 2,
                    "dist_atr": dist_atr,
                    "side": "up"
                })

        # Swing Low
        if candles[i][3] < min(c[3] for c in candles[i-3:i]) and candles[i][3] < min(c[3] for c in candles[i+1:i+4]):
            p_price = round(candles[i][3], 2)
            dist_atr = round(abs(p_price - curr_price) / max(atr, 0.1), 2)
            if any(c[3] < p_price for c in candles[i+1:]):
                swept_candle = next(c for c in candles[i+1:] if c[3] < p_price)
                swept.append({
                    "price": p_price,
                    "kind": "Снятие ликвидности Low",
                    "swept_time": swept_candle[0]
                })
            else:
                pools.append({
                    "price": p_price,
                    "kind": "Sell-side Liquidity",
                    "label": "Пул ликвидности на продажу",
                    "rating": 3 if dist_atr < 2.0 else 2,
                    "dist_atr": dist_atr,
                    "side": "down"
                })

    # 4. Market Structure Events (BOS / CHoCH)
    events = []
    for i in range(10, n - 2):
        if candles[i][4] > max(c[2] for c in candles[i-8:i]):
            events.append({
                "time": candles[i][0],
                "kind": "BOS" if candles[i-5][4] > candles[i-10][4] else "CHoCH",
                "scale": "swing",
                "level": round(candles[i][4], 2),
                "type": "bull"
            })
        elif candles[i][4] < min(c[3] for c in candles[i-8:i]):
            events.append({
                "time": candles[i][0],
                "kind": "BOS" if candles[i-5][4] < candles[i-10][4] else "CHoCH",
                "scale": "swing",
                "level": round(candles[i][4], 2),
                "type": "bear"
            })

    # 5. Trading Sessions
    sessions = []
    if n > 0:
        first_ts = candles[0][0]
        last_ts = candles[-1][0]
        curr_day = (first_ts // 86400) * 86400
        while curr_day <= last_ts + 86400:
            sessions.append({"name": "asia", "start": curr_day, "end": curr_day + 7 * 3600})
            sessions.append({"name": "london", "start": curr_day + 7 * 3600, "end": curr_day + 13 * 3600})
            sessions.append({"name": "ny", "start": curr_day + 13 * 3600, "end": curr_day + 21 * 3600})
            curr_day += 86400

    strong_weak = {
        "strong": {"p": round(min(c[3] for c in candles[-15:]), 2), "label": "Strong Low"},
        "weak": {"p": round(max(c[2] for c in candles[-15:]), 2), "label": "Weak High"}
    }

    return {
        "fvg": fvg_list[-6:],
        "ob": ob_list[-4:],
        "sessions": sessions,
        "events": events[-5:],
        "liquidity": {
            "pools": pools[-6:],
            "swept": swept[-4:]
        },
        "strong_weak": strong_weak
    }
