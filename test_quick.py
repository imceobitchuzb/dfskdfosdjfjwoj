import MetaTrader5 as mt5

print("Connecting to running MT5 without path argument...", flush=True)
res = mt5.initialize(timeout=5000)
print("mt5.initialize() returned:", res, flush=True)
if not res:
    print("Error:", mt5.last_error(), flush=True)
else:
    print("Success!", flush=True)
    print("Account:", mt5.account_info(), flush=True)
    mt5.shutdown()
