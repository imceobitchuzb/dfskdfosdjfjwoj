"""
Main runner for MT Trade Terminal.
Starts Uvicorn server and provides browser access.
"""
import sys
import time
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import uvicorn

if __name__ == "__main__":
    print("=" * 60)
    print("  [+] MT TRADE - Free Signals & TA Terminal")
    print("  [+] Entry, SL and 3 TPs for MT5")
    print("  [+] Server running on: http://127.0.0.1:8000")
    print("=" * 60)
    try:
        uvicorn.run("backend.server:app", host="127.0.0.1", port=8000, reload=False)
    except (KeyboardInterrupt, SystemExit):
        sys.exit(0)
    except Exception as e:
        print(f"Server exited with exception: {e}", flush=True)
        time.sleep(1)
