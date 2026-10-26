"""The TV's copies of the next songs, for Off the Record's webOS app.

The app tells it which files the coming songs play from (POST /want, with the token
it was started with); it downloads them from the karaoke server one at a time,
deletes the ones no longer coming, and serves them to the karaoke page on
127.0.0.1 (GET /files/<name>, with byte ranges, so the player can start mid-song).
The TV has a few hundred MB to spare, shared with its apps: it keeps under a
budget and leaves room free. With no word from the app for a while it exits; the
files stay for the next launch.

Python standard library only: it runs on the TV's own Python 3.
"""

# The TV and the machines that test this run whatever Python they came with.
from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.parse
import urllib.request

NAME = re.compile(r"^[0-9a-f]{20}\.(mp4|m4a|webm)$")
TYPES = {".mp4": "video/mp4", ".m4a": "audio/mp4", ".webm": "video/webm"}
CHUNK = 256 * 1024


class Cache:
    def __init__(self, root: str, budget: int, keep_free: int, idle: float) -> None:
        self.root = root
        self.budget = budget
        self.keep_free = keep_free
        self.idle = idle
        self.lock = threading.Lock()
        self.changed = threading.Event()
        self.server = ""
        self.token = ""
        self.songs: list[dict] = []
        self.busy: str | None = None
        self.error: str | None = None
        self.heard = time.monotonic()
        os.makedirs(root, exist_ok=True)

    def files(self) -> dict[str, int]:
        return {
            name: os.path.getsize(os.path.join(self.root, name))
            for name in os.listdir(self.root)
            if NAME.match(name)
        }

    def state(self) -> dict:
        with self.lock:
            busy, error = self.busy, self.error
        return {"files": self.files(), "busy": busy, "error": error}

    def want(self, server: str, token: str, songs: list[dict]) -> None:
        with self.lock:
            self.server, self.token = server, token
            self.songs = [s for s in songs if NAME.match(str(s.get("name", "")))]
        self.changed.set()

    def wanted(self) -> list[dict]:
        with self.lock:
            return list(self.songs)

    def run(self) -> None:
        while time.monotonic() - self.heard < self.idle:
            self.changed.wait(5)
            self.changed.clear()
            try:
                self.sync()
            except OSError as e:
                with self.lock:
                    self.error = str(e)
        sys.exit(0)

    def sync(self) -> None:
        songs = self.wanted()
        names = {s["name"] for s in songs}
        for name in os.listdir(self.root):
            if name not in names:
                os.remove(os.path.join(self.root, name))
        have = self.files()
        for song in songs:
            if song["name"] in have:
                continue
            kept = sum(have.values())
            free = shutil.disk_usage(self.root).free
            if kept + song["size"] > self.budget or free - song["size"] < self.keep_free:
                break  # the next songs come once these have been sung
            if not self.fetch(song):
                return
            have = self.files()

    def fetch(self, song: dict) -> bool:
        """Downloads one song; False if the list changed meanwhile or it failed."""
        with self.lock:
            server, token = self.server, self.token
            self.busy, self.error = song["name"], None
        path = os.path.join(self.root, song["name"])
        partial = path + ".part"
        request = urllib.request.Request(urllib.parse.urljoin(server, song["url"]))
        if token:
            request.add_header("X-Admin-Token", token)
        try:
            with urllib.request.urlopen(request, timeout=30) as r, open(partial, "wb") as f:
                while chunk := r.read(CHUNK):
                    if song["name"] not in {s["name"] for s in self.wanted()}:
                        raise InterruptedError("no longer coming")
                    f.write(chunk)
            os.replace(partial, path)
            return True
        except (OSError, InterruptedError) as e:
            if os.path.exists(partial):
                os.remove(partial)
            with self.lock:
                self.error = None if isinstance(e, InterruptedError) else f"{song['name']}: {e}"
            if not isinstance(e, InterruptedError):
                self.changed.wait(10)  # the server may be restarting
            return False
        finally:
            with self.lock:
                self.busy = None


def handler(cache: Cache, token: str):
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args) -> None:
            pass

        def cors(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Otr-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST")

        def reply(self, status: int, body: dict | None = None) -> None:
            data = json.dumps(body).encode() if body is not None else b""
            self.send_response(status)
            self.cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def authorized(self) -> bool:
            if self.headers.get("X-Otr-Token") != token:
                self.reply(403, {"error": "token"})
                return False
            cache.heard = time.monotonic()
            return True

        def do_OPTIONS(self) -> None:
            self.reply(204)

        def do_POST(self) -> None:
            if self.path != "/want":
                return self.reply(404)
            if not self.authorized():
                return
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                server = str(body["server"])
                if urllib.parse.urlparse(server).scheme not in ("http", "https"):
                    raise ValueError("server")
                cache.want(server, str(body.get("token") or ""), list(body["songs"]))
            except (ValueError, KeyError, TypeError):
                return self.reply(400, {"error": "body"})
            self.reply(200, cache.state())

        def do_GET(self) -> None:
            if self.path == "/state":
                if self.authorized():
                    self.reply(200, cache.state())
                return
            name = self.path.removeprefix("/files/")
            path = os.path.join(cache.root, name)
            if not self.path.startswith("/files/") or not NAME.match(name) or not os.path.isfile(path):
                return self.reply(404)
            self.send_file(path, os.path.splitext(name)[1])

        def send_file(self, path: str, ext: str) -> None:
            size = os.path.getsize(path)
            start, end = 0, size - 1
            match = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range") or "")
            if match and (match[1] or match[2]):
                if match[1]:
                    start = int(match[1])
                    end = min(int(match[2]), size - 1) if match[2] else size - 1
                else:
                    start = max(0, size - int(match[2]))
                if start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            else:
                self.send_response(200)
            self.cors()
            self.send_header("Content-Type", TYPES[ext])
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            self.end_headers()
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                try:
                    while left and (chunk := f.read(min(CHUNK, left))):
                        self.wfile.write(chunk)
                        left -= len(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # the player seeks by dropping a request

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--root", required=True)
    parser.add_argument("--port", type=int, default=47831)
    parser.add_argument("--budget-mb", type=int, default=200)
    parser.add_argument("--keep-free-mb", type=int, default=150)
    parser.add_argument("--idle", type=float, default=600, help="seconds without the app")
    args = parser.parse_args()
    token = os.environ.get("OTR_TOKEN", "")
    if len(token) < 16:
        sys.exit("otr-files: OTR_TOKEN (16+ characters) is required")
    cache = Cache(args.root, args.budget_mb * 2**20, args.keep_free_mb * 2**20, args.idle)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler(cache, token))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"otr-files: serving {args.root} on 127.0.0.1:{args.port}", flush=True)
    cache.run()


if __name__ == "__main__":
    main()
