"""Settings page: preferences and host controls."""

import os

import flask_babel
from flask import jsonify, render_template, request
from flask_smorest import Blueprint

from pikaraoke.constants import ITUNES_COUNTRIES, LANGUAGES, per_page_options
from pikaraoke.lib import keep_awake
from pikaraoke.lib.auth import public
from pikaraoke.lib.current_app import (
    get_admin_auth,
    get_karaoke_instance,
    get_site_name,
    is_admin,
)
from pikaraoke.lib.get_platform import is_linux, is_running_in_docker
from pikaraoke.lib.youtube_dl import youtube_cookies_file

_ = flask_babel.gettext


settings_bp = Blueprint("settings", __name__)


@settings_bp.route("/settings")
def settings():
    """Preferences and host controls. Public so a locked-out guest can log in."""
    k = get_karaoke_instance()
    return render_template(
        "settings.html",
        site_title=get_site_name(),
        # MSG: Title of the settings page.
        title=_("Settings"),
        admin=is_admin(),
        admin_password_set=get_admin_auth().is_password_set(),
        is_pi=k.is_raspberry_pi,
        is_linux=is_linux(),
        is_container=is_running_in_docker(),
        youtubedl_version=k.youtubedl_version,
        volume=int(k.volume * 100),
        bg_music_volume=int(k.bg_music_volume * 100),
        disable_bg_music=k.disable_bg_music,
        disable_bg_video=k.disable_bg_video,
        disable_score=k.disable_score,
        hide_notifications=k.hide_notifications,
        show_splash_clock=k.show_splash_clock,
        hide_url=k.hide_url,
        hide_qr_code=k.hide_qr_code,
        hide_session_name=k.hide_session_name,
        hide_logo=k.hide_logo,
        hide_overlay=k.hide_overlay,
        screensaver_timeout=k.screensaver_timeout,
        splash_scale=k.splash_scale,
        splash_delay=k.splash_delay,
        normalize_audio=k.normalize_audio,
        cdg_pixel_scaling=k.cdg_pixel_scaling,
        high_quality=k.high_quality,
        complete_transcode_before_play=k.complete_transcode_before_play,
        avsync=k.avsync,
        autoplay=k.autoplay,
        limit_user_songs_by=k.limit_user_songs_by,
        enable_fair_queue=k.enable_fair_queue,
        buffer_size=k.buffer_size,
        languages=LANGUAGES,
        preferred_language=k.preferences.get("preferred_language", "en"),
        itunes_countries=ITUNES_COUNTRIES,
        itunes_search_country=k.preferences.get_or_default("itunes_search_country"),
        suggestion_name_order=k.preferences.get_or_default("suggestion_name_order"),
        browse_results_per_page=k.browse_results_per_page,
        per_page_options=per_page_options(k.browse_results_per_page),
        enable_title_tidy=k.enable_title_tidy,
        enable_folder_browsing=k.enable_folder_browsing,
        score_phrases={
            "low": k.low_score_phrases,
            "mid": k.mid_score_phrases,
            "high": k.high_score_phrases,
        },
        mic_available=k.sound_manager.available,
        mic_passthrough_enabled=k.enable_mic_passthrough,
        keep_awake=k.keep_awake,
        youtube_cookies=os.path.isfile(youtube_cookies_file()),
        keep_awake_unsupported=keep_awake.unsupported_reason(),
    )


# A browser's export runs to a few hundred KB at most.
MAX_COOKIES_BYTES = 1_000_000
# yt-dlp reads only the Netscape cookies.txt format, which opens with one of these.
COOKIES_HEADERS = (b"# Netscape HTTP Cookie File", b"# HTTP Cookie File")


@settings_bp.route("/api/youtube_cookies", methods=["POST"])
def upload_youtube_cookies():
    """Store the host's exported YouTube cookies, for when YouTube blocks downloads."""
    upload = request.files.get("cookies")
    data = upload.read(MAX_COOKIES_BYTES + 1) if upload else b""
    if len(data) > MAX_COOKIES_BYTES or not data.lstrip().startswith(COOKIES_HEADERS):
        # MSG: Error shown when the uploaded YouTube cookies file is not a cookies.txt export.
        return jsonify({"error": _("That is not a cookies.txt file.")}), 400
    path = youtube_cookies_file()
    partial = f"{path}.part"
    # Private: the file signs in to the host's YouTube account.
    with open(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as f:
        f.write(data)
    os.replace(partial, path)
    return jsonify({"loaded": True})


@settings_bp.route("/api/youtube_cookies", methods=["DELETE"])
def remove_youtube_cookies():
    """Forget the YouTube cookies: downloads go out anonymously again."""
    path = youtube_cookies_file()
    if os.path.exists(path):
        os.remove(path)
    return jsonify({"loaded": False})
