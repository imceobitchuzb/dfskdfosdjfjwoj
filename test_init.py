import os
import sys
import MetaTrader5 as mt5

terminal_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
print(f"Testing mt5.initialize(path='{terminal_path}')...", flush=True)

# Try initializing MT5
res = mt5.initialize(path=terminal_path, timeout=10000)
print(f"initialize result: {res}", flush=True)

if not res:
    err = mt5.last_error()
    print(f"mt5.last_error(): {err}", flush=True)
else:
    print("MT5 successfully initialized!", flush=True)
    t_info = mt5.terminal_info()
    print("Terminal info:", t_info, flush=True)
    a_info = mt5.account_info()
    print("Account info:", a_info, flush=True)
    
    symbols = mt5.symbols_get()
    print("Total symbols available:", len(symbols) if symbols else 0, flush=True)
    if symbols:
        gold_symbols = [s.name for s in symbols if any(k in s.name.upper() for k in ["XAU", "GOLD"])]
        btc_symbols = [s.name for s in symbols if any(k in s.name.upper() for k in ["BTC"])]
        eur_symbols = [s.name for s in symbols if "EURUSD" in s.name.upper()]
        gbp_symbols = [s.name for s in symbols if "GBPUSD" in s.name.upper()]
        print("Gold symbols:", gold_symbols, flush=True)
        print("BTC symbols:", btc_symbols, flush=True)
        print("EUR symbols:", eur_symbols, flush=True)
        print("GBP symbols:", gbp_symbols, flush=True)
        
        # Test tick for gold
        if gold_symbols:
            test_sym = gold_symbols[0]
            mt5.symbol_select(test_sym, True)
            tick = mt5.symbol_info_tick(test_sym)
            print(f"Tick for {test_sym}:", tick, flush=True)
            rates = mt5.copy_rates_from_pos(test_sym, mt5.TIMEFRAME_M15, 0, 5)
            print(f"Last 5 M15 rates for {test_sym}:", rates, flush=True)
    
    mt5.shutdown()
