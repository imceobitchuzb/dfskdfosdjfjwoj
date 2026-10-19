import MetaTrader5 as mt5

print("Calling mt5.initialize(path=r'C:\\Program Files\\MetaTrader 5\\terminal64.exe', timeout=30000)...", flush=True)
res = mt5.initialize(path=r"C:\Program Files\MetaTrader 5\terminal64.exe", timeout=30000)
print(f"initialize result: {res}", flush=True)
if not res:
    print(f"last_error: {mt5.last_error()}", flush=True)
else:
    print("SUCCESS!", flush=True)
    print("terminal_info:", mt5.terminal_info(), flush=True)
    print("account_info:", mt5.account_info(), flush=True)
    mt5.shutdown()
