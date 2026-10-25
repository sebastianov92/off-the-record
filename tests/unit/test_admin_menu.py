"""The side menu: the host's pages are hidden from guests, and the login lives there."""

import pytest
from flask import Blueprint, render_template

from pikaraoke.lib.auth import public
from tests.conftest import make_route_app

HOST_PAGES = ['id="processing"', 'id="history"', 'id="sessions"', 'id="settings"']

probe_bp = Blueprint("probe", __name__)


@probe_bp.route("/probe")
@public
def probe():
    return render_template("base.html", site_title="PiKaraoke", title="Probe")


@probe_bp.route("/probe-settings")
@public
def probe_settings():
    # The settings page passes a bool by this name; the menu must not trip over it.
    return render_template(
        "base.html", site_title="PiKaraoke", title="Settings", admin_password_set=True
    )


def _menu(admin: bool) -> str:
    return make_route_app(probe_bp, [], admin=admin).test_client().get("/probe").text


@pytest.mark.parametrize("item", HOST_PAGES)
def test_a_guest_does_not_see_the_host_pages(item):
    assert item not in _menu(admin=False)


@pytest.mark.parametrize("item", HOST_PAGES)
def test_the_host_sees_them(item):
    assert item in _menu(admin=True)


def test_a_guest_gets_the_login_in_the_menu():
    page = _menu(admin=False)

    assert 'id="admin-login"' in page
    assert 'id="admin-login-modal"' in page


def test_with_no_password_there_is_nothing_to_log_into():
    page = _menu(admin=True)

    assert 'id="admin-login"' not in page
    assert 'id="admin-logout"' not in page


@pytest.mark.parametrize("admin", [True, False])
def test_the_menu_renders_beside_the_settings_page_variables(admin):
    response = make_route_app(probe_bp, [], admin=admin).test_client().get("/probe-settings")

    assert response.status_code == 200
