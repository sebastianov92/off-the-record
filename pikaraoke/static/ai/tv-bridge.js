// The webOS app's side of the splash. The app (a file:// page on the TV) shows this
// page in a frame and talks to it with postMessage: it sends playback commands,
// volumes and the microphone's pitch, and gets back what is playing. Commands go
// out as this page's own requests, so they need no CORS; the admin credential rides
// an X-Admin-Token header, because the Lax session cookie never reaches a frame
// whose top page is file://. Inert unless the page is framed with ?client=webos.
(function (root) {
  const BRIDGE = 1; // protocol version; changes are additive only
  const STATE_EVERY = 250; // ms between state checks
  const STATE_KEEPALIVE = 2000; // resend unchanged state this often: the app's liveness signal

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

  // env: {win, doc, fetch, socket, score, clock, base}. `win.parent` is the app.
  function createTvBridge(env) {
    const { win, doc, socket, score, clock, base } = env;
    let token = "";
    let np = null;
    let calib = null; // {audio, clock, clicks, onsets} while calibrating
    let kept = null; // {base, files: Set} once the app keeps song copies on the TV
    let upcoming = []; // the coming songs' files, from /api/tv/prefetch
    let lastPrefetch = "";
    const failed = new Set(); // copies the player could not read
    let prefetchTimer = 0;
    let lastState = "";
    let lastSent = 0;

    const post = (type, data = {}) => win.parent.postMessage({ otr: BRIDGE, type, ...data }, "*");
    const player = () => doc.getElementById("video");
    const headers = (json) => {
      const h = {};
      if (token) h["X-Admin-Token"] = token;
      if (json) h["Content-Type"] = "application/json";
      return h;
    };
    const retryAfter = (r) => Number(r.headers.get("Retry-After")) || undefined;

    // Each returns [path, JSON body or undefined].
    const COMMANDS = {
      pause: () => ["/api/pause"],
      skip: () => ["/api/skip"],
      restart: () => ["/api/restart"],
      volume: (v) => [`/api/volume/${clamp(v, 0, 1)}`],
      guide: (v) => ["/api/ai/guide_volume", { volume: Math.round(clamp(v, 0, 100)) }],
    };
    const CAPS = [...Object.keys(COMMANDS), "login", "pitch", "mic", "calibrate", "cache"];

    async function command(cmd) {
      if (cmd.action === "login") return login(cmd);
      const make = COMMANDS[cmd.action];
      if (!make) return post("result", { id: cmd.id, ok: false, status: 400 });
      const [path, body] = make(cmd.value);
      try {
        const r = await env.fetch(base + path, {
          method: "POST",
          headers: headers(!!body),
          body: body ? JSON.stringify(body) : undefined,
        });
        post("result", { id: cmd.id, ok: r.ok, status: r.status, retryAfter: retryAfter(r) });
      } catch (e) {
        post("result", { id: cmd.id, ok: false, status: 0 });
      }
    }

    // The password only passes through: the app keeps the token it buys.
    async function login(cmd) {
      try {
        const r = await env.fetch(`${base}/api/auth`, {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify({ admin_password: String(cmd.value || ""), issue_token: true }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.token) token = data.token;
        post("result", {
          id: cmd.id,
          ok: r.ok,
          status: r.status,
          retryAfter: retryAfter(r),
          token: data.token,
        });
        if (r.ok) await announce();
      } catch (e) {
        post("result", { id: cmd.id, ok: false, status: 0 });
      }
    }

    // Tells the app the bridge is up and whether its credential works.
    async function announce() {
      let auth = { required: false, ok: true };
      try {
        const r = await env.fetch(`${base}/api/auth`, { headers: headers(false) });
        const data = await r.json();
        auth = { required: !!data.password_required, ok: !!data.authenticated };
      } catch (e) {
        auth = { required: false, ok: false };
      }
      post("ready", {
        bridge: BRIDGE,
        caps: CAPS,
        auth,
        env: {
          ua: win.navigator.userAgent,
          hasPalmBridge: !!(win.PalmServiceBridge || win.webOSServiceBridge),
        },
      });
      sendState(true);
    }

    function currentState() {
      const video = player();
      const ai = np && np.now_playing_ai;
      const loaded = !!(np && np.now_playing);
      return {
        playing: loaded && !!video && !video.paused,
        paused: loaded && !!np.is_paused,
        title: (np && np.now_playing) || "",
        singer: (np && np.now_playing_user) || "",
        upNext: (np && np.up_next) || "",
        nextSinger: (np && np.next_user) || "",
        // The server's level, which every phone sets; the player only catches up
        // with it when a song loads.
        volume: Number((np && np.volume) ?? 1),
        guideVolume: ai ? Number(ai.guide_volume) || 0 : 0,
        hasGuide: !!ai,
        scorable: !!(ai && ai.pitch_url),
      };
    }

    // Sends when something changed, and at least every STATE_KEEPALIVE so the app
    // can tell a quiet song from a dead connection.
    function sendState(force) {
      const state = currentState();
      const key = JSON.stringify(state);
      const now = Date.now();
      if (!force && key === lastState && now - lastSent < STATE_KEEPALIVE) return;
      lastState = key;
      lastSent = now;
      const video = player();
      post("state", {
        ...state,
        position: video ? video.currentTime : 0,
        duration: video && isFinite(video.duration) ? video.duration : 0,
      });
    }

    function pitch(batch) {
      if (calib && !calib.audio.paused) calib.clock.place(batch, calib.audio.currentTime);
      const video = player();
      if (!video || video.paused) return;
      score.feed(clock.place(batch, video.currentTime));
    }

    // Eight short 2 kHz clicks, 0.6 s apart after a 1 s lead-in, as a WAV: played
    // by a media element, like the music, so they take the music's path out.
    const CLICKS = Array.from({ length: 8 }, (_, i) => 1 + i * 0.6);
    function clickTrack() {
      const rate = 48000, frames = Math.ceil((CLICKS[CLICKS.length - 1] + 1) * rate);
      const data = new DataView(new ArrayBuffer(44 + frames * 2));
      const text = (at, s) => [...s].forEach((c, i) => data.setUint8(at + i, c.charCodeAt(0)));
      text(0, "RIFF"); data.setUint32(4, 36 + frames * 2, true); text(8, "WAVEfmt ");
      data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
      data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true);
      data.setUint16(34, 16, true); text(36, "data"); data.setUint32(40, frames * 2, true);
      for (const at of CLICKS) {
        const start = Math.round(at * rate);
        for (let i = 0; i < rate * 0.005; i++) {
          const v = Math.sin((2 * Math.PI * 2000 * i) / rate) * 0.8 * 32767;
          data.setInt16(44 + (start + i) * 2, v, true);
        }
      }
      return new Blob([data.buffer], { type: "audio/wav" });
    }

    function calibrate() {
      if (calib) return;
      const audio = new win.Audio(win.URL.createObjectURL(clickTrack()));
      calib = { audio, clock: win.AiPitchClock.createPitchClock({ latency: 0 }), onsets: [] };
      const done = () => {
        const c = calib;
        calib = null;
        win.URL.revokeObjectURL(audio.src);
        const result = win.AiPitchClock.calibrationLatency(CLICKS, c.onsets);
        if (result) clock.setLatency(result.latency);
        post("calibrated", result || { latency: null });
      };
      audio.addEventListener("ended", done);
      audio.play().catch(() => {
        calib = null;
        post("calibrated", { latency: null });
      });
    }

    function onset(m) {
      if (!calib) return;
      const t = calib.clock.timeOf(m.frame, m.epoch);
      if (t !== null) calib.onsets.push(t);
    }

    function onMessage(event) {
      if (event.source !== win.parent) return;
      const m = event.data;
      if (!m || m.otr !== BRIDGE) return;
      switch (m.type) {
        case "init":
          token = typeof m.token === "string" ? m.token : "";
          if (typeof m.pitchLatency === "number") clock.setLatency(clamp(m.pitchLatency, 0, 1));
          announce();
          break;
        case "cmd":
          command(m);
          break;
        case "pitch":
          pitch(m);
          break;
        case "mic":
          score.useFeed(!!m.present);
          break;
        case "calibrate":
          calibrate();
          break;
        case "onset":
          onset(m);
          break;
        case "cache":
          kept = { base: String(m.base || ""), files: new Set(Array.isArray(m.files) ? m.files : []) };
          prefetchSoon();
          break;
      }
    }

    // The app keeps copies of the coming songs on the TV (song-cache.ts): it hears
    // which files they play from, and the playing song loads from the TV when the
    // copy is there, from the stream when it is not or the copy fails.
    function prefetchSoon() {
      if (!kept) return;
      win.clearTimeout(prefetchTimer);
      prefetchTimer = win.setTimeout(prefetch, 1000);
    }

    async function prefetch() {
      try {
        const r = await env.fetch(`${base}/api/tv/prefetch`, { headers: headers(false) });
        if (!r.ok) return;
        upcoming = (await r.json()).songs || [];
        const key = JSON.stringify(upcoming);
        if (key === lastPrefetch) return;
        lastPrefetch = key;
        post("prefetch", { songs: upcoming });
      } catch (e) {
        // Server unreachable: the next update asks again.
      }
    }

    // splash.js asks before it loads the playing song: the TV's copy, when there is one.
    function songCopy(data) {
      if (!kept || !data) return null;
      const song = upcoming.find((s) => s.file === data.now_playing_file);
      return song && kept.files.has(song.name) && !failed.has(song.name) ? kept.base + song.name : null;
    }

    // A copy the player could not read: true when it was one, so splash.js streams instead.
    function songCopyFailed(url) {
      if (!kept || !url || !url.startsWith(kept.base)) return false;
      failed.add(url.slice(kept.base.length));
      return true;
    }

    // A song's clock jumps on a seek, a pause or a new song: start the anchor over.
    function watchPlayer() {
      const video = player();
      if (!video) return;
      for (const name of ["seeked", "play", "pause", "loadstart"]) {
        video.addEventListener(name, () => clock.reset());
      }
    }

    // Autoplay may still want a click inside this frame. The app then hands its
    // focus over, and the confirm button takes the remote's OK.
    function watchPermissions() {
      const modal = doc.getElementById("permissions-modal");
      if (!modal) return;
      const report = () => {
        const needed = modal.classList.contains("is-active");
        post("gesture", { needed });
        if (needed) doc.getElementById("permissions-button")?.focus();
      };
      new win.MutationObserver(report).observe(modal, { attributes: true, attributeFilter: ["class"] });
      report();
    }

    function start() {
      // Never this page's microphone: on the TV it only hears silence.
      score.useFeed(false);
      doc.documentElement.classList.add("otr-webos");
      win.addEventListener("message", onMessage);
      // The app keeps the focus; a key that lands here anyway goes back to it, or
      // Back would do nothing and leave the singer stuck.
      doc.addEventListener("keydown", (e) => {
        if (doc.getElementById("permissions-modal")?.classList.contains("is-active")) return;
        post("key", { code: e.keyCode, key: e.key });
      });
      socket.on("now_playing", (data) => {
        np = data;
        sendState();
        prefetchSoon();
      });
      socket.on("ai_guide_volume", (data) => {
        if (np && np.now_playing_ai) np.now_playing_ai.guide_volume = data.volume;
        sendState();
      });
      socket.on("connect", () => announce());
      watchPlayer();
      win.tvSongCopy = songCopy;
      win.tvSongCopyFailed = songCopyFailed;
      watchPermissions();
      env
        .fetch(`${base}/api/now_playing`)
        .then((r) => r.json())
        .then((data) => {
          np = data;
          sendState(true);
        })
        .catch(() => {});
      win.setInterval(() => sendState(), STATE_EVERY);
      announce();
    }

    return { start, onMessage, announce, sendState, currentState, songCopy, songCopyFailed, token: () => token };
  }

  root.OtrTvBridge = { createTvBridge, BRIDGE };
  if (typeof module !== "undefined") module.exports = root.OtrTvBridge;

  if (
    typeof window !== "undefined" &&
    window.parent !== window &&
    new URLSearchParams(window.location.search).get("client") === "webos"
  ) {
    createTvBridge({
      win: window,
      doc: document,
      fetch: window.fetch.bind(window),
      // splash.js's own connection: a global const, not a window property.
      socket: typeof socket !== "undefined" ? socket : window.socket,
      score: window.aiScore,
      clock: window.AiPitchClock.createPitchClock(),
      base: window.pikaraokeConfig.basePath,
    }).start();
  }
})(typeof window !== "undefined" ? window : globalThis);
