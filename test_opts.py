import os
import sys
import subprocess
import time
import MetaTrader5 as mt5

print("Testing MT5 connection options...", flush=True)

# Option A: mt5.initialize() with path and timeout
term_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
print(f"Option A: mt5.initialize(path=r'{term_path}', timeout=15000)...", flush=True)
res_a = mt5.initialize(path=term_path, timeout=15000)
print(f"Result A: {res_a}, error: {mt5.last_error()}", flush=True)
if res_a:
    print("Terminal info:", mt5.terminal_info(), flush=True)
    print("Account info:", mt5.account_info(), flush=True)
    mt5.shutdown()
