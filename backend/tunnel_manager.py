"""
Cloudflare Tunnel Manager.
Automatically starts cloudflared quick tunnel, captures the HTTPS public URL,
and links it directly to the Telegram Mini App menu.
"""
import os
import re
import subprocess
import threading
import time
import logging

logger = logging.getLogger("tunnel_manager")

class TunnelManager:
    def __init__(self, port: int = 8000):
        self.port = port
        self.process = None
        self.tunnel_url = None
        self.is_running = False
        self.thread = None

    def start(self):
        if self.is_running:
            return
        self.is_running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        logger.info("TunnelManager started background supervisor.")

    def stop(self):
        self.is_running = False
        if self.process:
            try:
                self.process.terminate()
            except Exception:
                pass

    def _run_loop(self):
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        exe_path = os.path.join(base_dir, "cloudflared.exe")
        if not os.path.exists(exe_path):
            logger.warning(f"cloudflared.exe not found at {exe_path}. Public tunnel disabled.")
            return

        while self.is_running:
            try:
                logger.info(f"Launching Cloudflare Tunnel for port {self.port}...")
                self.process = subprocess.Popen(
                    [exe_path, "tunnel", "--url", f"http://127.0.0.1:{self.port}"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1
                )
                for line in self.process.stdout:
                    if not self.is_running:
                        break
                    match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
                    if match:
                        found_url = match.group(0)
                        if found_url != self.tunnel_url:
                            self.tunnel_url = found_url
                            logger.info(f"Cloudflare Public Tunnel READY: {self.tunnel_url}")
                            self._on_tunnel_ready(self.tunnel_url)
                self.process.wait()
            except Exception as e:
                logger.error(f"Cloudflare Tunnel execution error: {e}")

            if self.is_running:
                logger.info("Tunnel process ended. Re-launching in 3 seconds...")
                time.sleep(3)

    def _on_tunnel_ready(self, url: str):
        try:
            from backend.telegram_bot import telegram_bot
            from backend.config import save_dynamic_config
            import httpx

            telegram_bot.webapp_url = url
            save_dynamic_config({"webapp_url": url})

            # Fire setChatMenuButton via direct HTTP call to Telegram
            token = telegram_bot.token
            if token:
                tg_url = f"https://api.telegram.org/bot{token}/setChatMenuButton"
                payload = {
                    "menu_button": {
                        "type": "web_app",
                        "text": "📊 Терминал MT5",
                        "web_app": {"url": url}
                    }
                }
                httpx.post(tg_url, json=payload, timeout=5.0)
                logger.info(f"Successfully linked Telegram Menu button to: {url}")
        except Exception as e:
            logger.warning(f"Error updating Telegram bot menu with tunnel URL: {e}")

tunnel_manager = TunnelManager()
