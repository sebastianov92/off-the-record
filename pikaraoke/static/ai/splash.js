// AI layer of the splash screen. For a song the AI worker processed, the stream
// carries only the instrumental; this draws an animated background with the
// word-timed lyrics over the player, and plays the original vocals as a guide
// the singer can blend in, kept in step with the main player.
(function () {
  const DRIFT = 0.15; // seconds the guide may wander before it is pulled back
  // The idle screen, between songs: Off the Record's flow gradient in indigo, violet and
  // light pink, in place of a background video.
  const IDLE = { style: "flow", palette: ["#4A00E0", "#8E2DE2", "#FF6FB5"] };
  // The singer's avatar reads the singing this often, and a new face has to hold
  // this long before it shows, so it reacts without flickering between two.
  const MOOD_EVERY = 300;
  const MOOD_HOLD = 700;
  const WINK_EVERY = 3; // without a microphone, a wink on every third new line
  // How much the singer dances to the beat in each mood: a sleepy one does not.
  // Breaks ("thinking") are where the music carries it, so it dances through them too.
  const GROOVE = {
    love: 1.15, happy: 1.15, wink: 1, smug: 1, idle: 1, surprised: 0.9,
    thinking: 0.9, unsure: 0.6, shy: 0.5, sleepy: 0.15,
  };
  const STILL = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // One dance step per bar. For each beat of the bar: x, y move the whole face (% of
  // its size), tilt leans it (deg), look aims the eyes (drawing units, the face is
  // 100 across) and hop is how high it jumps (% of its height).
  const STEPS = {
    sway: {
      x: [-12, 12, -12, 12], y: [0, 0, 0, 0], tilt: [-10, 10, -10, 10],
      look: [[-7, 0], [7, 0], [-7, 0], [7, 0]], hop: [0, 0, 0, 0],
    },
    hop: {
      x: [0, 0, 0, 0], y: [0, 0, 0, 0], tilt: [-4, 4, -4, 4],
      look: [[0, -5], [-4, -5], [0, -5], [4, -5]], hop: [22, 14, 22, 14],
    },
    nod: {
      x: [-4, 4, -4, 4], y: [6, 0, 6, 0], tilt: [8, -8, 8, -8],
      look: [[-5, 4], [5, 4], [-5, 4], [5, 4]], hop: [0, 8, 0, 8],
    },
    look: {
      x: [0, 0, 0, 0], y: [0, 0, 0, 0], tilt: [-8, 0, 8, 0],
      look: [[-7, 0], [0, -6], [7, 0], [0, 5]], hop: [0, 0, 0, 0],
    },
  };
  const STEP_ORDER = ["sway", "hop", "nod", "look"];

  const guide = new Audio();
  guide.preload = "auto";
  let current = null; // now_playing_ai of the song on screen
  let guideVolume = 0;
  let stage, backgrounds, lyrics, idle, singer, singerFace, singerName;
  let mood = { shown: "idle", pending: null, since: 0, checked: 0, line: -1, lines: 0, winkUntil: 0 };
  let lyricsFor = null; // song_id whose lyrics are loaded
  let beatTimes = []; // seconds of each beat in the song on screen (beats.json)
  let beatIndex = 0; // the next beat to dance to
  let danceSeed = 0; // from the singer's name: which step each bar gets
  let raf = 0;

  const player = () => document.getElementById("video");

  function applyVolume() {
    const video = player();
    const master = video ? video.volume : 1;
    guide.volume = Math.max(0, Math.min(1, (guideVolume / 100) * master));
    if (guideVolume === 0) guide.pause();
    else if (video && !video.paused && current) sync(true);
  }

  function sync(play) {
    const video = player();
    if (!video || !current || guideVolume === 0) return;
    if (Math.abs(guide.currentTime - video.currentTime) > DRIFT) {
      guide.currentTime = video.currentTime;
    }
    if (play && guide.paused) guide.play().catch(() => {});
  }

  function buildStage() {
    stage = document.createElement("div");
    stage.id = "ai-stage";
    stage.className = "ai-stage";
    stage.hidden = true;
    const canvas = document.createElement("canvas");
    canvas.className = "ai-bg";
    const words = document.createElement("div");
    words.className = "ai-lyrics";
    singer = document.createElement("div");
    singer.className = "ai-singer";
    singer.hidden = true;
    singerFace = document.createElement("span");
    singerFace.className = "avatar ai-singer-face";
    singerName = document.createElement("div");
    singerName.className = "ai-singer-name";
    singer.append(singerFace, singerName);
    stage.append(canvas, words, singer);
    document.getElementById("video-container").append(stage);
    // The score screen shows the same singer with the face their score earned (score.js).
    const scoreFace = document.createElement("span");
    scoreFace.className = "avatar ai-score-avatar";
    document.getElementById("score")?.prepend(scoreFace);
    backgrounds = new AiBackgrounds(canvas);
    lyrics = new AiLyrics(words);
  }

  // Under the logo and the now-playing text; a song's player covers it, so it
  // rests then. A host who chose a background video (--bg-video-path) keeps it.
  function buildIdle() {
    if (PikaraokeConfig.bgVideoChoices.length) return;
    const canvas = document.createElement("canvas");
    canvas.id = "ai-idle";
    canvas.className = "ai-idle";
    document.getElementById("bg-video-container").after(canvas);
    idle = new AiBackgrounds(canvas);
  }

  function setIdle(on) {
    if (!idle) return;
    if (on) idle.showPalette(IDLE.style, IDLE.palette);
    else idle.stop();
  }

  function setSinger(name) {
    singer.hidden = !name;
    singerName.textContent = name || "";
    for (const el of [singerFace, ...document.querySelectorAll(".ai-score-avatar")]) {
      if (el.dataset.avatarName !== (name || "")) el.dataset.avatarName = name || "";
    }
    mood = { shown: "idle", pending: null, since: 0, checked: 0, line: -1, lines: 0, winkUntil: 0 };
    singerFace.dataset.avatarFace = "idle";
    danceSeed = [...(name || "")].reduce((sum, c) => sum + c.charCodeAt(0), 0);
    settle();
  }

  // With a microphone the face follows how the singing is going (score.js);
  // without one it follows the lyrics: thinking through a break, a wink now and then.
  function faceAt(t, now) {
    const live = window.aiScore && window.aiScore.mood(t);
    if (live) return live;
    const { idx, singing } = lyrics.state(t);
    if (!singing) return "thinking";
    if (idx !== mood.line) {
      mood.line = idx;
      mood.lines++;
      if (mood.lines % WINK_EVERY === 0) mood.winkUntil = now + 1200;
    }
    return now < mood.winkUntil ? "wink" : "idle";
  }

  function updateMood(t) {
    const now = performance.now();
    if (now - mood.checked < MOOD_EVERY) return;
    mood.checked = now;
    const face = faceAt(t, now);
    if (face === mood.shown) {
      mood.pending = null;
      return;
    }
    if (face !== mood.pending) {
      mood.pending = face;
      mood.since = now;
      return;
    }
    if (now - mood.since >= MOOD_HOLD || face === "wink") {
      mood.shown = face;
      mood.pending = null;
      singerFace.dataset.avatarFace = face;
    }
  }

  function replay(cls) {
    singerFace.classList.remove(cls);
    void singerFace.offsetWidth;
    singerFace.classList.add(cls);
  }

  // Each beat: the step of this bar (an order the singer's name picks, so two
  // singers dance differently) moves, leans and aims the face, and the body lands
  // squashed, springs up and comes down by the next beat. A blink now and then;
  // on the happiest bars, a spin every eighth one.
  function onBeat(i) {
    const groove = GROOVE[mood.shown] ?? 0.8;
    if (!groove) {
      settle();
      return;
    }
    const bar = Math.floor(i / 4);
    const b = i % 4;
    const step = STEPS[STEP_ORDER[(danceSeed + bar) % STEP_ORDER.length]];
    const period = (beatTimes[i + 1] ?? beatTimes[i] + 0.5) - beatTimes[i];
    const face = singerFace.style;
    face.setProperty("--sway-x", `${(step.x[b] * groove).toFixed(1)}%`);
    face.setProperty("--sway-y", `${(step.y[b] * groove).toFixed(1)}%`);
    face.setProperty("--tilt", `${(step.tilt[b] * groove).toFixed(1)}deg`);
    face.setProperty("--look-x", (step.look[b][0] * groove).toFixed(1));
    face.setProperty("--look-y", (step.look[b][1] * groove).toFixed(1));
    face.setProperty("--hop", `${(-step.hop[b] * groove).toFixed(1)}%`);
    face.setProperty("--squash", ((b === 0 ? 0.2 : 0.13) * groove).toFixed(2));
    face.setProperty("--beat", `${Math.min(0.5, period * 0.9).toFixed(2)}s`);
    face.setProperty("--move", `${Math.min(0.3, period * 0.5).toFixed(2)}s`);
    replay("beat");
    if (i % 8 === 5) {
      singerFace.classList.add("blink");
      setTimeout(() => singerFace.classList.remove("blink"), 140);
    }
    if (b === 0 && bar % 8 === 7 && groove >= 1) {
      replay("spin");
      setTimeout(() => singerFace.classList.remove("spin"), 750);
    }
  }

  function settle() {
    for (const name of ["--sway-x", "--sway-y", "--look-x", "--look-y"]) {
      singerFace.style.setProperty(name, "0");
    }
    singerFace.style.setProperty("--tilt", "0deg");
  }

  function dance(t, video) {
    if (STILL || !beatTimes.length) return;
    if (video.paused) {
      settle();
      return;
    }
    // After a seek back, pick up from there rather than replaying every beat.
    if (beatIndex > 0 && t < beatTimes[beatIndex - 1] - 0.2) beatIndex = 0;
    let crossed = -1;
    while (beatIndex < beatTimes.length && beatTimes[beatIndex] <= t) crossed = beatIndex++;
    if (crossed < 0) return;
    // A beat already well behind (a seek forward, a stall) is skipped, not danced late.
    // Late by up to half a beat still counts, so a slow TV drawing few frames keeps dancing.
    const period = (beatTimes[crossed + 1] ?? beatTimes[crossed] + 0.5) - beatTimes[crossed];
    if (t - beatTimes[crossed] < Math.min(0.3, period / 2)) onBeat(crossed);
  }

  function renderLoop() {
    const video = player();
    if (video && current) {
      const t = video.currentTime + (current.lyrics_offset || 0);
      lyrics.render(t);
      if (!singer.hidden) {
        updateMood(t);
        dance(video.currentTime, video);
      }
    }
    raf = requestAnimationFrame(renderLoop);
  }

  // The lyrics are asked for before the background is drawn, so a background
  // that fails can never leave the singer without words.
  function showStage(info) {
    stage.hidden = false;
    // The singer's name sits under their avatar now (stage.css hides the corner one).
    document.body.classList.add("ai-stage-on");
    if (lyricsFor !== info.song_id) {
      lyricsFor = info.song_id;
      lyrics.load([]);
      $.getJSON(info.lyrics_url, (doc) => {
        if (lyricsFor === info.song_id) lyrics.load(doc.lines);
      });
      beatTimes = [];
      beatIndex = 0;
      if (info.beats_url) {
        $.getJSON(info.beats_url, (doc) => {
          if (lyricsFor === info.song_id) beatTimes = doc.beats || [];
        });
      }
    }
    if (!raf) raf = requestAnimationFrame(renderLoop);
    const ink = backgrounds.show(info.song_id, Number(info.background) || 0);
    stage.classList.toggle("ai-ink-dark", ink === "dark");
  }

  function hideStage() {
    stage.hidden = true;
    document.body.classList.remove("ai-stage-on");
    backgrounds.stop();
    cancelAnimationFrame(raf);
    raf = 0;
    lyricsFor = null;
  }

  function load(info) {
    const sameGuide = current && info && current.guide_url === info.guide_url;
    current = info;
    window.aiScore.load(info);
    if (!info) {
      hideStage();
      guide.pause();
      guide.removeAttribute("src");
      guide.load();
      return;
    }
    guideVolume = info.guide_volume || 0;
    if (!sameGuide) {
      guide.src = info.guide_url;
      guide.load();
    }
    showStage(info);
    applyVolume();
  }

  function bindPlayer() {
    const video = player();
    if (!video || video.dataset.aiBound) return;
    video.dataset.aiBound = "1";
    video.addEventListener("play", () => sync(true));
    video.addEventListener("playing", () => sync(true));
    video.addEventListener("pause", () => guide.pause());
    video.addEventListener("seeked", () => sync(!video.paused));
    video.addEventListener("timeupdate", () => sync(false));
    video.addEventListener("volumechange", applyVolume);
    video.addEventListener("ended", () => guide.pause());
  }

  $(function () {
    guide.id = "ai-guide";
    document.body.append(guide);
    buildStage();
    buildIdle();
    // The TV's menu shows the app in an iframe over the TV's own background: there
    // its page is plain black, without the coloured lights it has on a phone.
    const menuFrame = document.querySelector("#menu-container iframe");
    menuFrame?.addEventListener("load", () => {
      menuFrame.contentDocument?.documentElement.classList.add("in-tv-menu");
    });
    bindPlayer();
    setIdle(true);
    socket.on("now_playing", (np) => {
      bindPlayer();
      const singerNow = np && np.now_playing ? np.now_playing_user : "";
      if (singerNow !== singerName.textContent) setSinger(singerNow);
      load(np && np.now_playing ? np.now_playing_ai : null);
      setIdle(!(np && np.now_playing));
    });
    socket.on("ai_guide_volume", (data) => {
      guideVolume = data.volume;
      applyVolume();
    });
  });
})();
