// Mini player: a bar fixed to the bottom of every page while a song is on, with
// restart, pause/play, skip and the music and vocal-guide volumes. Loaded once by
// base.html; it listens on the app-wide socket, not a page's, so it outlives SPA swaps.
(function () {
  const CONFIRM_MS = 3000;
  let state = null;
  let dragging = false;

  const $bar = () => $("#mini-player");
  const api = (path) => window.pikaraokeConfig.basePath + path;

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function render(np) {
    state = np;
    const on = !!(np && np.now_playing);
    $bar().toggleClass("is-hidden", !on);
    $("body").toggleClass("has-mini-player", on);
    if (!on) return;
    $("#mini-title").text(np.now_playing);
    $("#mini-singer").text(np.now_playing_user || "");
    $("#mini-avatar").attr("data-avatar-name", np.now_playing_user || "");
    const playing = window.isNowPlaying ? window.isNowPlaying(np) : !np.is_paused;
    $("#mini-pause i").toggleClass("icon-pause", playing).toggleClass("icon-play", !playing);
    if (!dragging) {
      $("#mini-music").val(np.volume);
      if (np.now_playing_ai) $("#mini-guide").val(np.now_playing_ai.guide_volume);
    }
    // The vocal guide exists only for songs the AI worker processed.
    $("#mini-guide-row").toggleClass("is-hidden", !np.now_playing_ai);
  }

  // Restart and skip act on the second tap: the first one swaps the icon for a
  // question, so a stray touch never cuts a song and no dialog covers the screen.
  function confirmTap(button, path) {
    const $b = $(button);
    if ($b.hasClass("is-confirming")) {
      clearTimeout($b.data("timer"));
      reset($b);
      $.post(api(path));
      return;
    }
    $b.data("icon", $b.html()).addClass("is-confirming").text($b.data("confirm"));
    $b.data("timer", setTimeout(() => reset($b), CONFIRM_MS));
  }

  function reset($b) {
    if ($b.hasClass("is-confirming")) $b.removeClass("is-confirming").html($b.data("icon"));
  }

  function bind() {
    $("#mini-restart").on("click", function () {
      confirmTap(this, "/api/restart");
    });
    $("#mini-skip").on("click", function () {
      confirmTap(this, "/api/skip");
    });
    // The bar shows only while a song is loaded, so the button always toggles it;
    // /api/play would only start a song waiting for a manual start.
    $("#mini-pause").on("click", () => $.post(api("/api/pause")));
    $("#mini-volume-toggle").on("click", function () {
      const open = $("#mini-volumes").toggleClass("is-hidden").hasClass("is-hidden") === false;
      this.setAttribute("aria-expanded", String(open));
    });
    $("#mini-music, #mini-guide")
      .on("pointerdown", () => (dragging = true))
      .on("pointerup pointercancel", () => (dragging = false));
    $("#mini-music").on("input", debounce(function () {
      $.post(api(`/api/volume/${this.value}`));
    }, 250));
    $("#mini-guide").on("input", debounce(function () {
      $.post(api("/api/ai/guide_volume"), { volume: this.value });
    }, 250));
  }

  $(function () {
    if (!document.getElementById("mini-player") || !window.socket) return;
    bind();
    window.socket.on("now_playing", render);
    window.socket.on("ai_guide_volume", (data) => {
      if (!dragging) $("#mini-guide").val(data.volume);
    });
    $.getJSON(api("/api/now_playing"), render);
  });
})();
