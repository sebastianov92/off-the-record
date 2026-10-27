"""Which pages may open the Socket.IO connection."""

from collections.abc import Callable
from urllib.parse import urlsplit


def socket_origin_check(url: str | None, port: int) -> Callable[[str, dict], bool]:
    """Pages this server served, at whatever address they reached it, plus --url's.

    A page whose origin is the address its own request went to is same-origin:
    the LAN address, a Tailscale one, a hostname. --url adds its origin and
    loopback, for a reverse proxy that rewrites Host and for the kiosk browser.
    Giving engineio a plain list instead replaced the same-origin rule, so a
    server started with --url (to print the right QR code) refused every other
    address it answers on: the splash kept losing its connection and missed
    every live change, such as the vocal guide's volume.
    """
    extra = set()
    if url:
        split = urlsplit(url)
        extra = {
            f"{split.scheme}://{split.netloc}",
            f"http://localhost:{port}",
            f"http://127.0.0.1:{port}",
            f"http://[::1]:{port}",
        }

    def accepted(origin: str, environ: dict) -> bool:
        if origin in extra:
            return True
        scheme = environ.get("HTTP_X_FORWARDED_PROTO", environ.get("wsgi.url_scheme", "http"))
        host = environ.get("HTTP_X_FORWARDED_HOST", environ.get("HTTP_HOST", ""))
        scheme, host = scheme.split(",")[0].strip(), host.split(",")[0].strip()
        return bool(host) and origin == f"{scheme}://{host}"

    return accepted
