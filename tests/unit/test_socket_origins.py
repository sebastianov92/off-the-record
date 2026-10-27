"""Socket.IO accepts pages this server served, at any address, plus --url's."""

from pikaraoke.lib.socket_origins import socket_origin_check


def _environ(host, scheme="http", **extra):
    return {"HTTP_HOST": host, "wsgi.url_scheme": scheme, **extra}


def test_a_page_from_any_address_of_the_server_connects_even_with_a_url_set():
    accepted = socket_origin_check("http://192.168.18.2:5555", 5555)

    # The same server reached over Tailscale: the QR shows the LAN address.
    assert accepted("http://100.68.180.29:5555", _environ("100.68.180.29:5555"))
    assert accepted("http://mini-pc:5555", _environ("mini-pc:5555"))


def test_the_url_and_loopback_connect_from_anywhere():
    accepted = socket_origin_check("http://karaoke.example/sub", 5555)

    assert accepted("http://karaoke.example", _environ("10.0.0.5:5555"))
    assert accepted("http://localhost:5555", _environ("10.0.0.5:5555"))


def test_another_site_does_not():
    accepted = socket_origin_check("http://192.168.18.2:5555", 5555)

    assert not accepted("http://evil.example", _environ("192.168.18.2:5555"))
    assert not accepted("http://evil.example", _environ(""))


def test_behind_a_proxy_the_forwarded_address_counts():
    accepted = socket_origin_check(None, 5555)

    assert accepted(
        "https://karaoke.example",
        _environ(
            "127.0.0.1:5555",
            HTTP_X_FORWARDED_PROTO="https",
            HTTP_X_FORWARDED_HOST="karaoke.example",
        ),
    )
