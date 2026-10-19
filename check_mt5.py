import os
import sys
import winreg

print("Python version:", sys.version, flush=True)

try:
    import MetaTrader5 as mt5
    print("MetaTrader5 package version:", mt5.__version__, flush=True)
except Exception as e:
    print("Failed to import MetaTrader5:", e, flush=True)
    mt5 = None

def find_mt5_paths():
    found = []
    # Check common locations
    defaults = [
        r"C:\Program Files\MetaTrader 5\terminal64.exe",
        r"C:\Program Files (x86)\MetaTrader 5\terminal64.exe",
        r"C:\Program Files\MetaTrader 5 Terminal\terminal64.exe",
        r"C:\Program Files\PuPrime MetaTrader 5\terminal64.exe",
        r"C:\Program Files\Exness MetaTrader 5\terminal64.exe",
        r"C:\Program Files\RoboForex MetaTrader 5\terminal64.exe",
        r"C:\Program Files\ICMarkets MetaTrader 5\terminal64.exe",
        r"C:\Program Files\FTMO MetaTrader 5\terminal64.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\MetaTrader 5\terminal64.exe"),
        os.path.expandvars(r"%APPDATA%\MetaQuotes\Terminal\terminal64.exe"),
    ]
    for p in defaults:
        if os.path.exists(p):
            found.append(p)
            
    # Check AppData MetaQuotes
    appdata_mq = os.path.expandvars(r"%APPDATA%\MetaQuotes\Terminal")
    if os.path.exists(appdata_mq):
        print(f"MetaQuotes AppData directory exists: {appdata_mq}", flush=True)
        try:
            print("Contents of AppData MetaQuotes:", os.listdir(appdata_mq), flush=True)
        except Exception:
            pass

    return list(set(found))

paths = find_mt5_paths()
print("Found MT5 paths:", paths, flush=True)

# Also search Program Files for any directory containing MetaTrader or MT5
for root_dir in [r"C:\Program Files", r"C:\Program Files (x86)", os.path.expandvars(r"%LOCALAPPDATA%\Programs")]:
    if os.path.exists(root_dir):
        try:
            for item in os.listdir(root_dir):
                if any(x in item.lower() for x in ["metatrader", "mt5", "puprime", "exness", "roboforex", "icmarkets"]):
                    full = os.path.join(root_dir, item)
                    print(f"Candidate broker/terminal directory: {full}", flush=True)
                    t64 = os.path.join(full, "terminal64.exe")
                    if os.path.exists(t64):
                        print(f"-> Found executable: {t64}", flush=True)
                        paths.append(t64)
        except Exception as e:
            pass

print("All candidate paths:", paths, flush=True)
