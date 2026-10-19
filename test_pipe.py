import os
import MetaTrader5 as mt5

print("Testing direct mt5.initialize()...", flush=True)

# 1. Without args
r1 = mt5.initialize(timeout=5000)
print("1. mt5.initialize(timeout=5000) ->", r1, mt5.last_error(), flush=True)
if r1:
    print("Success 1!")
    mt5.shutdown()

# 2. With path
r2 = mt5.initialize(path=r"C:\Program Files\MetaTrader 5\terminal64.exe", timeout=5000)
print("2. mt5.initialize(path=..., timeout=5000) ->", r2, mt5.last_error(), flush=True)
if r2:
    print("Success 2!")
    mt5.shutdown()

# 3. With portable=False
r3 = mt5.initialize(path=r"C:\Program Files\MetaTrader 5\terminal64.exe", portable=False, timeout=5000)
print("3. mt5.initialize(portable=False, timeout=5000) ->", r3, mt5.last_error(), flush=True)
if r3:
    print("Success 3!")
    mt5.shutdown()

# 4. Check pipe accessibility
pipe_path = r"\\.\pipe\MT5.Terminal.781AEDD6B227148DB36F632AFAB710BBA441CCEA07ED9EF5BC7B94FAED25BD12"
try:
    with open(pipe_path, 'r+b') as f:
        print("Pipe opened successfully!", flush=True)
except Exception as e:
    print("Pipe open exception:", e, flush=True)
