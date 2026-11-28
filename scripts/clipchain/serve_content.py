"""Serve local ClipChain storyboards on the existing review port."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


WORK = Path(r"D:\ClipChainWork")
FOLDERS = ("EP1", "studio", "EP6", "Salon", "MG", "pilot-storyboard")
ROUTES = {f"/{folder}/{name}" for folder in FOLDERS for name in ("index.html", "index.json")}


class ReviewHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        route = urlsplit(self.path).path
        if route == "/":
            self.send_response(302)
            folder = "EP1" if (WORK / "EP1" / "index.html").is_file() else "pilot-storyboard"
            self.send_header("Location", f"/{folder}/index.html")
            self.end_headers()
            return None
        if route not in ROUTES:
            self.send_error(404)
            return None
        return super().send_head()


if __name__ == "__main__":
    handler = partial(ReviewHandler, directory=str(WORK))
    with ThreadingHTTPServer(("127.0.0.1", 8040), handler) as server:
        server.serve_forever()
