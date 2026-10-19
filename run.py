"""
Main runner for MT Trade Terminal.
Starts Uvicorn server and provides browser access.
"""
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import uvicorn

if __name__ == "__main__":
    print("=" * 60)
    print("  [+] MT TRADE - Free Signals & TA Terminal")
    print("  [+] Entry, SL and 3 TPs for MT5")
    print("  [+] Server running on: http://127.0.0.1:8000")
    print("=" * 60)
    uvicorn.run("backend.server:app", host="127.0.0.1", port=8000, reload=False)
