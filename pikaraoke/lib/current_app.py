"""Flask application context utilities for PiKaraoke."""

import hmac
import logging
from typing import Any

from flask import current_app, request, session
from flask_socketio import emit

from pikaraoke.karaoke import Karaoke
from pikaraoke.lib.admin_auth import AdminAuth
from pikaraoke.lib.login_throttle import LoginThrottle


def is_admin() -> bool:
    """Whether this request is authenticated as the admin.

    With no admin password set everyone is an admin -- the right default for a box
    on a home TV. Otherwise it takes a signed session established by /auth, or the
    device token in an X-Admin-Token header (the webOS app, which has no cookie).
    A custom header always needs a CORS preflight, which this server never grants,
    so another site cannot make a browser send it.
    """
    auth = get_admin_auth()
    if not auth.is_password_set() or session.get("admin") == auth.session_token:
        return True
    token = request.headers.get("X-Admin-Token", "")
    return bool(token) and hmac.compare_digest(token, auth.device_token)


def get_karaoke_instance() -> Karaoke:
    """Get the current app's Karaoke instance
    This function returns the Karaoke instance stored in the current app's configuration.
    Returns:
        Karaoke: The Karaoke instance stored in the current app's configuration.
    """
    return current_app.config["KARAOKE_INSTANCE"]


def get_admin_auth() -> AdminAuth:
    """Get the current app's admin authentication store."""
    return current_app.config["ADMIN_AUTH"]


def get_login_throttle() -> LoginThrottle:
    """Get the current app's login brute-force throttle."""
    return current_app.config["LOGIN_THROTTLE"]


def get_site_name() -> str:
    """Get the site name from the current app's configuration
    This function returns the site name stored in the current app's configuration.
    Returns:
        str: The site name stored in the current app's configuration.
    """
    return current_app.config["SITE_NAME"]


def broadcast_event(event: str, data: Any = None) -> None:
    """Broadcast a SocketIO event to all connected clients.

    Args:
        event: Name of the event to broadcast.
        data: Optional data payload to send with the event.
    """
    logging.debug("Broadcasting event: " + event)
    emit(event, data, namespace="/", broadcast=True)
